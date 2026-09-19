import { v4 as uuidv4 } from 'uuid';
import { Content } from '@google/generative-ai';
import { GeminiProvider } from '../gemini/gemini.provider';
import { ToolRegistry } from '../tools/registry';
import { ConfirmationService } from '../confirmation/confirmation.service';
import { ChatRepository } from '../../database/repositories/chat.repo';
import { MessageEntity } from '../../database/repositories/types';
import { parseDueAt } from '../../database/repositories/reminder.repo';
import { config } from '../../config/env';
import { logger } from '../../core/logger';

export interface AgentRunInput {
  userId: string;
  conversationId?: string;
  channel: 'flutter' | 'whatsapp';
  text: string;
  mediaUrl?: string;
}

export interface AgentRunOutput {
  conversationId: string;
  agentRunId: string;
  status: 'completed' | 'waiting_for_confirmation' | 'failed';
  replyText: string;
  toolCallsExecuted: Array<{
    toolName: string;
    arguments: Record<string, any>;
    result: any;
  }>;
  confirmationRequest?: {
    token: string;
    actionName: string;
    description: string;
    expiresAt: string;
  };
}

/**
 * Normalizes chat history into alternating Gemini turns:
 * 1. user -> model -> user -> model ... -> user
 * 2. Merges consecutive messages of the same role
 * 3. Drops leading model messages if any exist
 * 4. Guarantees latest user input is the final turn
 */
export function formatConversationHistory(
  messages: MessageEntity[],
  currentInput: string
): Content[] {
  const turns: Array<{ role: 'user' | 'model'; text: string }> = [];

  for (const m of messages) {
    const text = m.text?.trim();
    if (!text) continue;
    const role: 'user' | 'model' = m.senderRole === 'user' ? 'user' : 'model';
    turns.push({ role, text });
  }

  // Ensure current input is the latest user turn
  if (
    turns.length === 0 ||
    turns[turns.length - 1].role !== 'user' ||
    turns[turns.length - 1].text !== currentInput.trim()
  ) {
    turns.push({ role: 'user', text: currentInput.trim() });
  }

  // Merge consecutive turns of identical roles
  const mergedTurns: Array<{ role: 'user' | 'model'; text: string }> = [];
  for (const turn of turns) {
    if (mergedTurns.length > 0 && mergedTurns[mergedTurns.length - 1].role === turn.role) {
      mergedTurns[mergedTurns.length - 1].text += `\n${turn.text}`;
    } else {
      mergedTurns.push({ ...turn });
    }
  }

  // Ensure conversation starts with user turn
  while (mergedTurns.length > 0 && mergedTurns[0].role !== 'user') {
    mergedTurns.shift();
  }

  if (mergedTurns.length === 0) {
    mergedTurns.push({ role: 'user', text: currentInput.trim() });
  }

  return mergedTurns.map((t) => ({
    role: t.role,
    parts: [{ text: t.text }],
  }));
}

export class AgentOrchestrator {
  constructor(
    private geminiProvider: GeminiProvider = new GeminiProvider(),
    private toolRegistry: ToolRegistry = ToolRegistry.getInstance(),
    private confirmationService: ConfirmationService = new ConfirmationService(),
    private chatRepo: ChatRepository = new ChatRepository()
  ) {}

  public async run(input: AgentRunInput): Promise<AgentRunOutput> {
    const agentRunId = uuidv4();
    logger.info(`Starting Agent run [${agentRunId}] on channel [${input.channel}]`, {
      userId: input.userId,
    });

    // 1. Get or create conversation
    const conversation = await this.chatRepo.getOrCreateConversation(
      input.userId,
      input.channel
    );
    const conversationId = conversation.id;

    // 2. Persist user message
    await this.chatRepo.saveMessage(
      conversationId,
      'user',
      input.channel === 'whatsapp' ? 'WhatsApp User' : 'User',
      input.text,
      input.mediaUrl
    );

    // 3. Load recent history for context (up to 20 past turns for strong multi-turn memory)
    const recentMessages = await this.chatRepo.getRecentMessages(conversationId, 20);
    const contents: Content[] = formatConversationHistory(recentMessages, input.text);

    let iterations = 0;
    const toolCallsExecuted: AgentRunOutput['toolCallsExecuted'] = [];
    let finalReply = '';

    // 4. ReAct Agent Loop
    while (iterations < config.security.maxIterations) {
      iterations++;
      logger.debug(`Agent ReAct iteration [${iterations}/${config.security.maxIterations}]`);

      const geminiResponse = await this.geminiProvider.generateReply(contents);

      // Check if Gemini invoked function calls
      if (geminiResponse.functionCalls && geminiResponse.functionCalls.length > 0) {
        const fc = geminiResponse.functionCalls[0];
        const tool = this.toolRegistry.getTool(fc.name);

        if (!tool) {
          logger.warn(`Unknown tool requested: [${fc.name}]`);
          contents.push({
            role: 'model',
            parts: [{ text: `Called tool: ${fc.name}` }],
          });
          contents.push({
            role: 'user',
            parts: [{ text: `Tool [${fc.name}] error: Tool not found in registry.` }],
          });
          continue;
        }

        // Check if tool requires confirmation
        if (tool.isSensitive) {
          const confirmation = await this.confirmationService.createConfirmationRequest(
            agentRunId,
            input.userId,
            tool.name,
            `طلب تأكيد لتنفيذ عملية: ${tool.name}`,
            fc.args
          );

          let promptDetails = JSON.stringify(fc.args);
          if (tool.name === 'create_reminder') {
            const parsedTime = parseDueAt(fc.args.time);
            let formattedTime = fc.args.time || 'قريباً';
            if (parsedTime) {
              formattedTime = new Intl.DateTimeFormat('ar-EG-u-nu-latn', {
                timeZone: 'Africa/Cairo',
                hour: 'numeric',
                minute: 'numeric',
                day: 'numeric',
                month: 'long',
              }).format(parsedTime);
            }
            promptDetails = `الموضوع: "${fc.args.title || 'بدون عنوان'}" | الموعد: ${formattedTime}`;
          }

          const promptNotice = `هذا الإجراء يتطلب تأكيدك الصريح للمتابعة:
- العملية: ${tool.name === 'create_reminder' ? 'إنشاء تذكير جديد' : tool.name}
- التفاصيل: ${promptDetails}
يرجى التأكيد باستخدام الرمز: ${confirmation.token}`;

          await this.chatRepo.saveMessage(conversationId, 'assistant', 'Craft', promptNotice);

          return {
            conversationId,
            agentRunId,
            status: 'waiting_for_confirmation',
            replyText: promptNotice,
            toolCallsExecuted,
            confirmationRequest: {
              token: confirmation.token,
              actionName: confirmation.actionName,
              description: confirmation.description,
              expiresAt: confirmation.expiresAt.toISOString(),
            },
          };
        }

        // Execute safe tool
        logger.info(`Executing tool [${tool.name}]`, { args: fc.args });
        const toolResult = await this.toolRegistry.executeTool(tool.name, fc.args, {
          userId: input.userId,
          conversationId,
          channel: input.channel,
        });

        toolCallsExecuted.push({
          toolName: tool.name,
          arguments: fc.args,
          result: toolResult.output || toolResult.error,
        });

        // Feed tool result back into model context
        contents.push({
          role: 'model',
          parts: [{ text: `Called tool: ${tool.name}` }],
        });
        contents.push({
          role: 'user',
          parts: [
            {
              text: `Tool [${tool.name}] result: ${JSON.stringify(
                toolResult.output || toolResult.error
              )}`,
            },
          ],
        });
        continue;
      }

      // Model returned text response
      finalReply = geminiResponse.text || 'تم معالجة طلبك بنجاح.';
      break;
    }

    if (!finalReply) {
      finalReply = 'تم تنفيذ الأدوات المطلوبة بنجاح.';
    }

    // 5. Persist assistant reply
    await this.chatRepo.saveMessage(conversationId, 'assistant', 'Craft', finalReply);

    logger.info(`Agent run [${agentRunId}] completed successfully`);
    return {
      conversationId,
      agentRunId,
      status: 'completed',
      replyText: finalReply,
      toolCallsExecuted,
    };
  }
}
