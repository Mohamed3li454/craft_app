import { v4 as uuidv4 } from 'uuid';
import { Content } from '@google/generative-ai';
import { GeminiProvider } from '../gemini/gemini.provider';
import { ToolRegistry } from '../tools/registry';
import { ConfirmationService } from '../confirmation/confirmation.service';
import { ChatRepository } from '../../database/repositories/chat.repo';
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

    // 3. Load recent history for context
    const recentMessages = await this.chatRepo.getRecentMessages(conversationId, 10);
    const contents: Content[] = recentMessages.map((m) => ({
      role: m.senderRole === 'user' ? 'user' : 'model',
      parts: [{ text: m.text }],
    }));

    // If latest message was not in recent (e.g. fresh conversation), append it
    if (contents.length === 0 || contents[contents.length - 1].parts[0]?.text !== input.text) {
      contents.push({
        role: 'user',
        parts: [{ text: input.text }],
      });
    }

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
            role: 'function' as any,
            parts: [{ text: JSON.stringify({ error: `Tool ${fc.name} not found` }) }],
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

          const promptNotice = `هذا الإجراء يتطلب تأكيدك الصريح للمتابعة:
- العملية: ${tool.name}
- التفاصيل: ${JSON.stringify(fc.args)}
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
