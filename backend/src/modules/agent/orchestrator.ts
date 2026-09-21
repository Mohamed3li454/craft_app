import { v4 as uuidv4 } from 'uuid';
import { Content, Part } from '@google/generative-ai';
import mammoth from 'mammoth';
import { GeminiProvider } from '../gemini/gemini.provider';
import { GroqProvider, GroqMessage } from '../groq/groq.provider';
import { ToolRegistry } from '../tools/registry';
import { ConfirmationService } from '../confirmation/confirmation.service';
import { ChatRepository } from '../../database/repositories/chat.repo';
import { MessageEntity } from '../../database/repositories/types';
import { parseDueAt } from '../../database/repositories/reminder.repo';
import { MemoryRepository } from '../../database/repositories/memory.repo';
import { config } from '../../config/env';
import { logger } from '../../core/logger';

export interface AgentMediaAttachment {
  buffer: Buffer;
  mimeType: string;
  filename?: string;
}

export interface AgentRunInput {
  userId: string;
  conversationId?: string;
  channel: 'flutter' | 'whatsapp';
  text: string;
  mediaUrl?: string;
  media?: AgentMediaAttachment;
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
 * Prepares user prompt and multimodal parts from media attachments:
 * - Images: inline base64 Part for Gemini vision
 * - PDFs: inline base64 Part with application/pdf
 * - Word docs (.docx): extracts raw text via mammoth and embeds in prompt
 * - Code & text (.dart, .ts, .md, .txt, etc.): decodes UTF-8 and embeds in prompt
 */
export async function processMediaAttachment(
  userText: string,
  media?: AgentMediaAttachment
): Promise<{
  effectivePrompt: string;
  mediaPart?: Part;
  historyRecordText: string;
}> {
  const cleanText = (userText || '').trim();

  if (!media) {
    return {
      effectivePrompt: cleanText,
      historyRecordText: cleanText,
    };
  }

  const filename = media.filename || '';
  const lastDot = filename.lastIndexOf('.');
  const ext = lastDot !== -1 ? filename.substring(lastDot).toLowerCase() : '';
  const mime = (media.mimeType || '').toLowerCase();

  // 1. Image formats (JPEG, PNG, WebP, GIF, HEIC, BMP)
  const isImage =
    mime.startsWith('image/') ||
    ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.heic'].includes(ext);
  if (isImage) {
    const defaultImagePrompt = 'حلل هذه الصورة المرفقة واشرح ما تراه فيها بشكل مفصل ودقيق.';
    const effectivePrompt = cleanText
      ? `${cleanText}\n(مرفق صورة مع هذا الطلب)`
      : defaultImagePrompt;
    const historyRecordText = cleanText ? `[صورة مرفقة] ${cleanText}` : '[صورة مرفقة]';
    const mediaPart: Part = {
      inlineData: {
        data: media.buffer.toString('base64'),
        mimeType: mime.startsWith('image/') ? mime : 'image/jpeg',
      },
    };
    return { effectivePrompt, mediaPart, historyRecordText };
  }

  // 2. Audio & Voice Notes (OGG Opus from WhatsApp, MP3, WAV, AAC, M4A)
  const cleanMime = mime.split(';')[0].trim();
  const isAudio =
    cleanMime.startsWith('audio/') ||
    ['.ogg', '.opus', '.mp3', '.m4a', '.aac', '.wav', '.flac', '.amr'].includes(ext);
  if (isAudio) {
    const defaultAudioPrompt =
      'استمع إلى هذا التسجيل الصوتي المرفق بعناية وافهم ما يقوله المستخدم بدقة، ثم أجب عليه أو نفذ طلبه بالشكل المطلوب كوكيل ذكي.';
    const effectivePrompt = cleanText
      ? `${cleanText}\n(مرفق تسجيل صوتي مع هذا الطلب)`
      : defaultAudioPrompt;
    const historyRecordText = cleanText
      ? `[تسجيل صوتي: ${cleanText}]`
      : '[تسجيل صوتي من المستخدم]';

    let finalAudioMime = cleanMime.startsWith('audio/') ? cleanMime : 'audio/ogg';
    if (finalAudioMime === 'audio/opus') {
      finalAudioMime = 'audio/ogg';
    }

    const mediaPart: Part = {
      inlineData: {
        data: media.buffer.toString('base64'),
        mimeType: finalAudioMime,
      },
    };
    return { effectivePrompt, mediaPart, historyRecordText };
  }

  // 3. PDF Documents
  const isPdf = mime === 'application/pdf' || ext === '.pdf';
  if (isPdf) {
    const defaultPdfPrompt = 'اقرأ هذا المستند المرفق بصيغة PDF واشرح أو لخص محتواه بالتفصيل.';
    const effectivePrompt = cleanText
      ? `${cleanText}\n(مرفق مستند PDF: ${filename || 'document.pdf'})`
      : defaultPdfPrompt;
    const historyRecordText = cleanText
      ? `[ملف PDF مرفق: ${filename || 'document.pdf'}] ${cleanText}`
      : `[ملف PDF مرفق: ${filename || 'document.pdf'}]`;
    const mediaPart: Part = {
      inlineData: {
        data: media.buffer.toString('base64'),
        mimeType: 'application/pdf',
      },
    };
    return { effectivePrompt, mediaPart, historyRecordText };
  }

  // 3. Word Documents (.docx)
  const isDocx = ext === '.docx' || mime.includes('wordprocessingml') || mime.includes('msword');
  if (isDocx) {
    let docText = '';
    try {
      const result = await mammoth.extractRawText({ buffer: media.buffer });
      docText = result.value.trim();
    } catch (err: any) {
      logger.warn('Failed to extract text from DOCX with mammoth', { error: err.message });
      docText = '(تعذر استخراج النص من ملف Word تلقائياً)';
    }

    const defaultDocxPrompt = 'اقرأ محتوى هذا المستند المرفق واشرح أهم ما ورد فيه بالتفصيل.';
    const effectivePrompt = `[ملف Word مرفق: ${filename || 'document.docx'}]\n\nمحتوى المستند:\n\`\`\`text\n${docText}\n\`\`\`\n\n${cleanText || defaultDocxPrompt}`;
    const historyRecordText = cleanText
      ? `[ملف Word مرفق: ${filename || 'document.docx'}] ${cleanText}`
      : `[ملف Word مرفق: ${filename || 'document.docx'}]`;

    return { effectivePrompt, historyRecordText };
  }

  // 4. Code & Text Files (.dart, .ts, .js, .py, .json, .yaml, .md, .txt, etc.)
  const codeExtensions: Record<string, string> = {
    '.dart': 'dart',
    '.ts': 'typescript',
    '.tsx': 'typescript',
    '.js': 'javascript',
    '.jsx': 'javascript',
    '.json': 'json',
    '.yaml': 'yaml',
    '.yml': 'yaml',
    '.md': 'markdown',
    '.txt': 'text',
    '.py': 'python',
    '.html': 'html',
    '.css': 'css',
    '.xml': 'xml',
    '.sql': 'sql',
    '.sh': 'bash',
    '.env': 'dotenv',
    '.csv': 'csv',
    '.java': 'java',
    '.kt': 'kotlin',
    '.swift': 'swift',
    '.c': 'c',
    '.cpp': 'cpp',
    '.h': 'c',
    '.rs': 'rust',
    '.go': 'go',
  };

  const isCodeOrText =
    codeExtensions[ext] !== undefined ||
    mime.startsWith('text/') ||
    mime.includes('json') ||
    mime.includes('xml') ||
    mime.includes('javascript');

  if (isCodeOrText) {
    const lang = codeExtensions[ext] || 'text';
    const textContent = media.buffer.toString('utf-8');
    const defaultCodePrompt =
      'افحص واقرأ هذا الكود/الملف المرفق واشرح وظيفته بالتفصيل أو أجب عن أي استفسار بشأنه.';
    const effectivePrompt = `[ملف برمجي/نصي مرفق: ${filename || 'file'}]\n\`\`\`${lang}\n${textContent}\n\`\`\`\n\n${cleanText || defaultCodePrompt}`;
    const historyRecordText = cleanText
      ? `[ملف مرفق: ${filename || 'file'}] ${cleanText}`
      : `[ملف مرفق: ${filename || 'file'}]`;

    return { effectivePrompt, historyRecordText };
  }

  // 5. Fallback for other file types: attempt UTF-8 decoding
  try {
    const textContent = media.buffer.toString('utf-8');
    if (!textContent.includes('\u0000')) {
      const effectivePrompt = `[ملف مرفق: ${filename || 'file'}]\n\`\`\`\n${textContent}\n\`\`\`\n\n${cleanText || 'اقرأ محتوى هذا الملف المرفق واشرحه بالتفصيل.'}`;
      const historyRecordText = cleanText
        ? `[ملف مرفق: ${filename || 'file'}] ${cleanText}`
        : `[ملف مرفق: ${filename || 'file'}]`;
      return { effectivePrompt, historyRecordText };
    }
  } catch {
    // Binary fallback
  }

  const effectivePrompt = `[ملف مرفق: ${filename || 'file'} (نوع: ${mime || 'غير معروف'})]\n${cleanText || 'تم استلام الملف المرفق بنجاح.'}`;
  const historyRecordText = `[ملف مرفق: ${filename || 'file'}] ${cleanText}`.trim();
  return { effectivePrompt, historyRecordText };
}

/**
 * Normalizes chat history into alternating Gemini turns:
 * 1. user -> model -> user -> model ... -> user
 * 2. Merges consecutive messages of the same role
 * 3. Drops leading model messages if any exist
 * 4. Guarantees latest user input is the final turn (with optional mediaPart attached)
 */
export function formatConversationHistory(
  messages: MessageEntity[],
  currentInput: string,
  mediaPart?: Part
): Content[] {
  const turns: Array<{ role: 'user' | 'model'; text: string }> = [];

  for (const m of messages) {
    const text = m.text?.trim();
    if (!text) continue;
    const role: 'user' | 'model' = m.senderRole === 'user' ? 'user' : 'model';
    turns.push({ role, text });
  }

  // Ensure current input is the latest user turn
  if (turns.length > 0 && turns[turns.length - 1].role === 'user') {
    turns[turns.length - 1].text = currentInput.trim();
  } else {
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

  return mergedTurns.map((t, index) => {
    const isLastTurn = index === mergedTurns.length - 1;
    if (isLastTurn && t.role === 'user' && mediaPart) {
      return {
        role: t.role,
        parts: [mediaPart, { text: t.text }],
      };
    }
    return {
      role: t.role,
      parts: [{ text: t.text }],
    };
  });
}

export function formatGroqConversationHistory(
  messages: MessageEntity[],
  currentInput: string
): GroqMessage[] {
  const turns: GroqMessage[] = [];

  for (const m of messages) {
    const text = m.text?.trim();
    if (!text) continue;
    const role: 'user' | 'assistant' = m.senderRole === 'user' ? 'user' : 'assistant';
    turns.push({ role, content: text });
  }

  // Ensure current input is the latest user turn
  if (turns.length > 0 && turns[turns.length - 1].role === 'user') {
    turns[turns.length - 1].content = currentInput.trim();
  } else {
    turns.push({ role: 'user', content: currentInput.trim() });
  }

  // Merge consecutive turns of identical roles
  const mergedTurns: GroqMessage[] = [];
  for (const turn of turns) {
    if (mergedTurns.length > 0 && mergedTurns[mergedTurns.length - 1].role === turn.role) {
      mergedTurns[mergedTurns.length - 1].content += `\n${turn.content}`;
    } else {
      mergedTurns.push({ ...turn });
    }
  }

  // Ensure conversation starts with user turn
  while (mergedTurns.length > 0 && mergedTurns[0].role !== 'user') {
    mergedTurns.shift();
  }

  if (mergedTurns.length === 0) {
    mergedTurns.push({ role: 'user', content: currentInput.trim() });
  }

  return mergedTurns;
}

export class AgentOrchestrator {
  constructor(
    private groqProvider: GroqProvider = new GroqProvider(),
    private geminiProvider: GeminiProvider = new GeminiProvider(),
    private toolRegistry: ToolRegistry = ToolRegistry.getInstance(),
    private confirmationService: ConfirmationService = new ConfirmationService(),
    private chatRepo: ChatRepository = new ChatRepository(),
    private memoryRepo: MemoryRepository = new MemoryRepository()
  ) {}

  public async run(input: AgentRunInput): Promise<AgentRunOutput> {
    const agentRunId = uuidv4();
    logger.info(`Starting Agent run [${agentRunId}] on channel [${input.channel}]`, {
      userId: input.userId,
      hasMedia: !!input.media,
    });

    // 1. If WhatsApp channel, consolidate any fragmented conversations into the primary one
    if (input.channel === 'whatsapp') {
      await this.chatRepo.consolidateWhatsAppConversations(input.userId);
    }

    // 2. If voice note (audio) attached, transcribe it via Groq Whisper first!
    let textToProcess = input.text || '';
    const cleanMime = (input.media?.mimeType || '').split(';')[0].trim().toLowerCase();
    const isAudio =
      cleanMime.startsWith('audio/') ||
      ['.ogg', '.opus', '.mp3', '.m4a', '.aac', '.wav', '.flac', '.amr'].some((ext) =>
        (input.media?.filename || '').toLowerCase().endsWith(ext)
      );

    if (input.media && isAudio) {
      const transcribed = await this.groqProvider.transcribeAudio(
        input.media.buffer,
        cleanMime || 'audio/ogg',
        input.media.filename || 'voice_note.ogg'
      );
      if (transcribed) {
        textToProcess = textToProcess ? `${textToProcess}\n${transcribed}` : transcribed;
      }
    }

    // 3. Process any media attachments (images, PDFs, docx, code files)
    const { effectivePrompt, mediaPart, historyRecordText } = await processMediaAttachment(
      textToProcess,
      input.media
    );

    // 4. Extract and persist any facts mentioned by user in long-term memory
    if (textToProcess) {
      await this.memoryRepo.extractAndSaveFacts(input.userId, textToProcess);
    }
    const memories = await this.memoryRepo.getMemories(input.userId);

    // 5. Get or create conversation
    const conversation = await this.chatRepo.getOrCreateConversation(
      input.userId,
      input.channel
    );
    const conversationId = conversation.id;

    // 6. Persist user message in chat history
    await this.chatRepo.saveMessage(
      conversationId,
      'user',
      input.channel === 'whatsapp' ? 'WhatsApp User' : 'User',
      historyRecordText || effectivePrompt,
      input.mediaUrl
    );

    // 7. Load recent history for context (up to 20 past turns for strong multi-turn memory)
    const recentMessages = await this.chatRepo.getRecentMessages(conversationId, 20);

    const isImage =
      input.media &&
      (cleanMime.startsWith('image/') ||
        ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.heic'].some((ext) =>
          (input.media?.filename || '').toLowerCase().endsWith(ext)
        ));

    const imageAttachment = isImage
      ? {
          data: input.media!.buffer.toString('base64'),
          mimeType: input.media!.mimeType || 'image/jpeg',
        }
      : undefined;

    let iterations = 0;
    const toolCallsExecuted: AgentRunOutput['toolCallsExecuted'] = [];
    let finalReply = '';

    // Primary Execution: Groq LPU Engine (GPT-OSS 120B / Qwen 3.8 27B)
    try {
      const groqMessages = formatGroqConversationHistory(recentMessages, effectivePrompt);

      while (iterations < config.security.maxIterations) {
        iterations++;
        logger.debug(`Agent Groq ReAct iteration [${iterations}/${config.security.maxIterations}]`);

        const groqResponse = await this.groqProvider.generateReply(
          groqMessages,
          true,
          memories,
          iterations === 1 ? imageAttachment : undefined
        );

        if (groqResponse.functionCalls && groqResponse.functionCalls.length > 0) {
          const fc = groqResponse.functionCalls[0];
          const tool = this.toolRegistry.getTool(fc.name);

          if (!tool) {
            logger.warn(`Unknown tool requested: [${fc.name}]`);
            groqMessages.push({
              role: 'assistant',
              content: `Called tool: ${fc.name}`,
            });
            groqMessages.push({
              role: 'user',
              content: `Tool [${fc.name}] error: Tool not found in registry.`,
            });
            continue;
          }

          if (tool.isSensitive) {
            const confirmation = await this.confirmationService.createConfirmationRequest(
              agentRunId,
              input.userId,
              tool.name,
              `طلب تأكيد لتنفيذ عملية: ${tool.name}`,
              fc.args,
              conversationId
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

          logger.info(`Executing tool [${tool.name}] via Groq`, { args: fc.args });
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

          groqMessages.push({
            role: 'assistant',
            content: null as any,
            tool_calls: [
              {
                id: fc.id || `fc_${Date.now()}`,
                type: 'function',
                function: {
                  name: tool.name,
                  arguments: JSON.stringify(fc.args),
                },
              },
            ],
          });
          groqMessages.push({
            role: 'tool',
            tool_call_id: fc.id || `fc_${Date.now()}`,
            name: tool.name,
            content: JSON.stringify(toolResult.output || toolResult.error),
          });
          continue;
        }

        finalReply = groqResponse.text || 'تم معالجة طلبك بنجاح.';
        break;
      }
    } catch (groqErr: any) {
      logger.warn('Groq provider error or unconfigured, falling back to Gemini provider', {
        error: groqErr.message,
      });

      // Secondary Fallback: Gemini Provider
      const contents: Content[] = formatConversationHistory(
        recentMessages,
        effectivePrompt,
        mediaPart
      );

      iterations = 0;
      while (iterations < config.security.maxIterations) {
        iterations++;
        const geminiResponse = await this.geminiProvider.generateReply(contents, true, memories);

        if (geminiResponse.functionCalls && geminiResponse.functionCalls.length > 0) {
          const fc = geminiResponse.functionCalls[0];
          const tool = this.toolRegistry.getTool(fc.name);

          if (!tool) {
            contents.push({ role: 'model', parts: [{ text: `Called tool: ${fc.name}` }] });
            contents.push({
              role: 'user',
              parts: [{ text: `Tool [${fc.name}] error: Tool not found in registry.` }],
            });
            continue;
          }

          if (tool.isSensitive) {
            const confirmation = await this.confirmationService.createConfirmationRequest(
              agentRunId,
              input.userId,
              tool.name,
              `طلب تأكيد لتنفيذ عملية: ${tool.name}`,
              fc.args,
              conversationId
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

          contents.push({ role: 'model', parts: [{ text: `Called tool: ${tool.name}` }] });
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

        finalReply = geminiResponse.text || 'تم معالجة طلبك بنجاح.';
        break;
      }
    }

    if (!finalReply) {
      finalReply = 'تم تنفيذ الأدوات المطلوبة بنجاح.';
    }

    // Persist assistant reply
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

  /**
   * Intelligently dispatches a due reminder by letting the LLM inspect the reminder intent,
   * call appropriate live tools (e.g. get_weather, web_search), and formulate a complete, rich notification.
   */
  public async generateSmartReminder(userId: string, reminderTitle: string): Promise<string> {
    try {
      const memories = await this.memoryRepo.getMemories(userId);
      const prompt = `[نظام التذكيرات الذكية]
حان الآن موعد تذكير للمستخدم. عنوان التذكير: "${reminderTitle}".
المطلوب منك كوكيل ذكي:
1. تحقق بدقة: هل يتطلب هذا التذكير جلب معلومات حية أو حالية للمستخدم؟
   - إذا كان عن الطقس (مثل: طقس القاهرة، أحوال الجو): استدعِ أداة get_weather فوراً لجلب حالة الطقس الفعلية الحالية!
   - إذا كان عن أخبار (مثل: أهم أخبار نيويورك، أخبار تقنية): استدعِ أداة web_search فوراً لجلب الأخبار الحية الحالية!
   - إذا كان عن أي معلومة أخرى: استدعِ الأداة المناسبة.
2. بعد جلب المعلومات (أو إذا كان التذكير تنبيهاً شخصياً عادياً مثل موعد دواء أو صلاة أو اجتماع):
   صِغ رسالة التذكير بأسلوب ودود وجميل ومباشر باللهجة المصرية، تبدأ بـ:
   ⏰ *تذكير من كرافت*:
   ثم تفاصيل التذكير والمعلومات المطلوبة بدقة وتنسيق مرتب، واختم بعبارة تشجيعية دافئة.`;

      const conv = await this.chatRepo.getOrCreateConversation(userId, 'whatsapp');

      // Try GroqProvider first
      try {
        const groqMessages: GroqMessage[] = [{ role: 'user', content: prompt }];
        let iterations = 0;
        while (iterations < config.security.maxIterations) {
          iterations++;
          const reply = await this.groqProvider.generateReply(groqMessages, true, memories);

          if (reply.functionCalls && reply.functionCalls.length > 0) {
            const fc = reply.functionCalls[0];
            const tool = this.toolRegistry.getTool(fc.name);
            if (tool) {
              const toolResult = await this.toolRegistry.executeTool(tool.name, fc.args, {
                userId,
                conversationId: conv.id,
                channel: 'whatsapp',
              });
              groqMessages.push({
                role: 'assistant',
                content: null as any,
                tool_calls: [
                  {
                    id: fc.id || `fc_${Date.now()}`,
                    type: 'function',
                    function: {
                      name: tool.name,
                      arguments: JSON.stringify(fc.args),
                    },
                  },
                ],
              });
              groqMessages.push({
                role: 'tool',
                tool_call_id: fc.id || `fc_${Date.now()}`,
                name: tool.name,
                content: JSON.stringify(toolResult.output || toolResult.error),
              });
              continue;
            }
          }

          if (reply.text && reply.text.trim()) {
            return reply.text.trim();
          }
          break;
        }
      } catch (groqErr: any) {
        logger.warn('Groq failed for smart reminder, attempting Gemini fallback', {
          error: groqErr.message,
        });

        // Gemini Fallback
        const contents: Content[] = [{ role: 'user', parts: [{ text: prompt }] }];
        let iterations = 0;
        while (iterations < config.security.maxIterations) {
          iterations++;
          const reply = await this.geminiProvider.generateReply(contents, true, memories);

          if (reply.functionCalls && reply.functionCalls.length > 0) {
            const fc = reply.functionCalls[0];
            const tool = this.toolRegistry.getTool(fc.name);
            if (tool) {
              const toolResult = await this.toolRegistry.executeTool(tool.name, fc.args, {
                userId,
                conversationId: conv.id,
                channel: 'whatsapp',
              });
              contents.push({ role: 'model', parts: [{ text: `Called tool: ${tool.name}` }] });
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
          }

          if (reply.text && reply.text.trim()) {
            return reply.text.trim();
          }
          break;
        }
      }
    } catch (err: any) {
      logger.warn('Failed to generate smart reminder content, falling back to default', {
        error: err.message,
      });
    }

    return `⏰ *تذكير من كرافت*:\n\n📌 *الموضوع*: "${reminderTitle}"\n\nحان الآن موعد هذا التذكير المحدد! أرجو أن تكون في أتم صحة وعافية.`;
  }
}
