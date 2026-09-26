import { v4 as uuidv4 } from 'uuid';
import mammoth from 'mammoth';
import { GroqProvider, GroqMessage } from '../groq/groq.provider';
import { ToolRegistry } from '../tools/registry';
import { ConfirmationService } from '../confirmation/confirmation.service';
import { ChatRepository } from '../../database/repositories/chat.repo';
import { MessageEntity } from '../../database/repositories/types';
import { parseDueAt } from '../../database/repositories/reminder.repo';
import { MemoryRepository } from '../../database/repositories/memory.repo';
import { UserRepository } from '../../database/repositories/user.repo';
import { SemanticCacheEngine } from '../cache/semantic_cache_engine';
import { LearningPipeline } from '../cache/learning/learning_pipeline';
import { cleanWhatsAppText } from '../whatsapp/formatter';
import { config } from '../../config/env';
import { logger } from '../../core/logger';

export interface AgentMediaAttachment {
  buffer: Buffer;
  mimeType: string;
  filename?: string;
}

export interface AgentRunInput {
  userId: string;
  userPhone?: string;
  userName?: string;
  conversationId?: string;
  channel: 'flutter' | 'whatsapp';
  text: string;
  mediaUrl?: string;
  media?: AgentMediaAttachment;
  onInterimProgress?: (message: string) => Promise<void> | void;
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
  metrics?: {
    modelUsed: string;
    latencyMs: number;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

/**
 * Prepares user prompt and text from media attachments:
 * - Images: user prompt/caption for Groq vision
 * - PDFs: user prompt/caption (raw text parsing is not yet implemented)
 * - Word docs (.docx): extracts raw text via mammoth and embeds in prompt
 * - Code & text (.dart, .ts, .md, .txt, etc.): decodes UTF-8 and embeds in prompt
 */
export async function processMediaAttachment(
  userText: string,
  media?: AgentMediaAttachment
): Promise<{
  effectivePrompt: string;
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
    return { effectivePrompt, historyRecordText };
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
    return { effectivePrompt, historyRecordText };
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
    return { effectivePrompt, historyRecordText };
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


export function formatGroqConversationHistory(
  messages: MessageEntity[],
  currentInput: string
): GroqMessage[] {
  const turns: GroqMessage[] = [];

  // Limit to the most recent 4 messages to avoid exceeding Groq TPM limits
  const slicedMessages = messages.slice(-4);

  for (const m of slicedMessages) {
    let text = m.text?.trim();
    if (!text || text.includes('Called tool:') || text.startsWith('Tool [')) continue;
    const role: 'user' | 'assistant' = m.senderRole === 'user' ? 'user' : 'assistant';
    // Truncate previous assistant responses to max 350 characters to keep prompt compact
    if (role === 'assistant' && text.length > 350) {
      text = text.substring(0, 350) + '...';
    }
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

export function serializeToolResultForGroq(toolName: string, outputOrError: any): string {
  if (toolName === 'web_search' && outputOrError?.results && Array.isArray(outputOrError.results)) {
    const compactResults = outputOrError.results.slice(0, 8).map((r: any) => {
      let sourceSite = '';
      if (r.url) {
        try {
          sourceSite = new URL(r.url).hostname.replace('www.', '');
        } catch {}
      }
      return {
        title: r.title,
        snippet: (r.snippet || '').substring(0, 500),
        source: sourceSite || undefined,
      };
    });
    return JSON.stringify({
      status: 'search_complete',
      query: outputOrError.query,
      results: compactResults,
      instruction:
        'Live search completed. Synthesize your final comprehensive response in natural, friendly Egyptian Arabic now based on the search results above. You MUST state the exact prices, numbers in EGP (جنيه مصري) and USD, storage costs, and distributor details (e.g. Tradeline/تريدلاين) found in the results directly. Do not omit the numbers or be evasive. Never mention RSS, search engine, or API. Do not call any browsing or tool functions; output final text directly.',
    });
  }
  return JSON.stringify(outputOrError);
}

export class AgentOrchestrator {
  constructor(
    private groqProvider: GroqProvider = new GroqProvider(),
    private toolRegistry: ToolRegistry = ToolRegistry.getInstance(),
    private confirmationService: ConfirmationService = new ConfirmationService(),
    private chatRepo: ChatRepository = new ChatRepository(),
    private memoryRepo: MemoryRepository = new MemoryRepository(),
    private userRepo: UserRepository = new UserRepository()
  ) {}

  public async run(input: AgentRunInput): Promise<AgentRunOutput> {
    const runStartTime = Date.now();
    const agentRunId = uuidv4();
    logger.info(`Starting Agent run [${agentRunId}] on channel [${input.channel}]`, {
      userId: input.userId,
      hasMedia: !!input.media,
    });

    let lastModelUsed = config.groq.primaryModel;
    let accumulatedPromptTokens = 0;
    let accumulatedCompletionTokens = 0;
    let accumulatedTotalTokens = 0;

    let interimSent = false;
    const sendInterim = async (msg: string) => {
      if (interimSent || !input.onInterimProgress || !msg) return;
      interimSent = true;
      try {
        await input.onInterimProgress(msg);
      } catch (err: any) {
        logger.warn('Failed to dispatch interim progress message', { error: err.message });
      }
    };

    const cleanUserText = (input.text || '').trim();

    // 0. FAQ & Semantic Cache Check (0 tokens, latency <15ms)
    if (!input.media && cleanUserText) {
      const cacheResult = await SemanticCacheEngine.getInstance().process(cleanUserText, {
        userId: input.userId,
        userName: input.userName,
        conversationId: input.conversationId,
        channel: input.channel,
      });

      if (cacheResult.type === 'hit' && cacheResult.response) {
        const conversation = await this.chatRepo.getOrCreateConversation(input.userId, input.channel);
        const conversationId = conversation.id;
        const modelName = 'semantic-cache';

        await Promise.all([
          this.chatRepo.saveMessage(
            conversationId,
            'user',
            input.channel === 'whatsapp' ? 'WhatsApp User' : 'User',
            cleanUserText
          ),
          this.chatRepo.saveMessage(
            conversationId,
            'assistant',
            'Craft',
            cacheResult.response,
            undefined,
            {
              tokensUsed: 0,
              promptTokens: 0,
              completionTokens: 0,
              modelName,
              latencyMs: Date.now() - runStartTime,
            }
          ),
        ]);

        return {
          conversationId,
          agentRunId,
          status: 'completed',
          replyText: cacheResult.response,
          toolCallsExecuted: [],
          metrics: {
            modelUsed: modelName,
            latencyMs: Date.now() - runStartTime,
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: 0,
          },
        };
      }
    }

    // 0.1 User Daily Rate Limit Check (Free tier: 40 msgs/day, VIP: unlimited)
    const limitCheck = await this.userRepo.checkAndIncrementDailyLimit(
      input.userId,
      input.userPhone
    );
    if (!limitCheck.allowed) {
      logger.warn(`Daily limit exceeded for user [${input.userId}], phone [${input.userPhone || 'none'}]`);
      const conversation = await this.chatRepo.getOrCreateConversation(input.userId, input.channel);
      const conversationId = conversation.id;
      const rateLimitReply =
        'يا هلا بيك يا غالي! 🌟 لقد وصلت للحد الأقصى لعدد الرسائل اليومية المجانية (40 رسالة). هيتم تجديد رصيدك بالكامل مع بداية يوم جديد بإذن الله! لو محتاج مساعدة فورية أو باقة غير محدودة تقدر تتواصل مع الإدارة. نهارك سعيد! ✨';

      await Promise.all([
        this.chatRepo.saveMessage(
          conversationId,
          'user',
          input.channel === 'whatsapp' ? 'WhatsApp User' : 'User',
          cleanUserText || '[رسالة]'
        ),
        this.chatRepo.saveMessage(
          conversationId,
          'assistant',
          'Craft',
          rateLimitReply,
          undefined,
          {
            tokensUsed: 0,
            promptTokens: 0,
            completionTokens: 0,
            modelName: 'rate-limiter',
            latencyMs: Date.now() - runStartTime,
          }
        ),
      ]);

      return {
        conversationId,
        agentRunId,
        status: 'completed',
        replyText: rateLimitReply,
        toolCallsExecuted: [],
        metrics: {
          modelUsed: 'rate-limiter',
          latencyMs: Date.now() - runStartTime,
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
        },
      };
    }

    // 1. If WhatsApp channel, consolidate any fragmented conversations into the primary one in background
    if (input.channel === 'whatsapp') {
      this.chatRepo.consolidateWhatsAppConversations(input.userId).catch((err) => {
        logger.debug('Consolidate conversations background error', { error: err.message });
      });
    }

    // 2. If voice note (audio) attached, transcribe it via Groq Whisper first!
    let textToProcess = input.text || '';
    const cleanMime = (input.media?.mimeType || '').split(';')[0].trim().toLowerCase();
    const isAudio =
      cleanMime.startsWith('audio/') ||
      ['.ogg', '.opus', '.mp3', '.m4a', '.aac', '.wav', '.flac', '.amr'].some((ext) =>
        (input.media?.filename || '').toLowerCase().endsWith(ext)
      );

    const cleanMimeForCheck = (input.media?.mimeType || '').toLowerCase();
    const filenameForCheck = input.media?.filename || '';
    const extForCheck = filenameForCheck.includes('.')
      ? filenameForCheck.substring(filenameForCheck.lastIndexOf('.')).toLowerCase()
      : '';
    const isImg =
      cleanMimeForCheck.startsWith('image/') ||
      ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.heic'].includes(extForCheck);

    let mediaType = 'text';
    if (input.media) {
      if (isAudio) mediaType = 'audio';
      else if (isImg) mediaType = 'image';
      else mediaType = 'document';
    }

    // Immediate interim dispatch for media attachments (0ms latency)
    if (input.media) {
      if (isAudio) {
        await sendInterim('ثواني أسمع الفويس وأرد عليك يا باشا! 🎙️');
      } else if (isImg) {
        await sendInterim('ثواني هبص في الصورة وأقولك رأيي يا هندسة! 👁️');
      } else {
        await sendInterim('ثواني هقرأ الملف المرفق وأرجعلك بالخلاصة يا باشا! 📄');
      }
    }

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

    // Concurrent, non-blocking pre-flight intent & interim generator for text queries via Groq (~150ms)
    if (!interimSent && input.onInterimProgress && textToProcess && !input.media) {
      this.groqProvider
        .generateInterimAcknowledgement(textToProcess)
        .then(async (acknowledged) => {
          if (acknowledged && !interimSent) {
            await sendInterim(acknowledged);
          }
        })
        .catch((err) => {
          logger.debug('Concurrent interim check failed', { error: err.message });
        });
    }

    // 3. Process any media attachments (images, PDFs, docx, code files)
    const { effectivePrompt, historyRecordText } = await processMediaAttachment(
      textToProcess,
      input.media
    );

    // 4 & 5. Parallelize conversation resolution, memory facts extraction & memories retrieval
    const [conversation, memories] = await Promise.all([
      this.chatRepo.getOrCreateConversation(input.userId, input.channel),
      (async () => {
        if (textToProcess) {
          try {
            await this.memoryRepo.extractAndSaveFacts(input.userId, textToProcess);
          } catch (err: any) {
            logger.debug('Memory fact extraction error', { error: err.message });
          }
        }
        return this.memoryRepo.getMemories(input.userId);
      })(),
    ]);
    const conversationId = conversation.id;

    // 6 & 7. Concurrently load recent history while persisting incoming message in background
    const [recentMessages] = await Promise.all([
      this.chatRepo.getRecentMessages(conversationId, 8),
      this.chatRepo.saveMessage(
        conversationId,
        'user',
        input.channel === 'whatsapp' ? 'WhatsApp User' : 'User',
        historyRecordText || effectivePrompt,
        input.mediaUrl,
        { mediaType }
      ),
    ]);

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

    const toolCallsExecuted: AgentRunOutput['toolCallsExecuted'] = [];
    let finalReply = '';

    const runGroqLoop = async (): Promise<AgentRunOutput | null> => {
      const groqMessages = formatGroqConversationHistory(recentMessages, effectivePrompt);
      let groqIterations = 0;
      while (groqIterations < config.security.maxIterations) {
        groqIterations++;
        logger.debug(`Agent Groq ReAct iteration [${groqIterations}/${config.security.maxIterations}]`);

        const isFirstIteration = groqIterations === 1;
        const groqResponse = await this.groqProvider.generateReply(
          groqMessages,
          isFirstIteration,
          memories,
          isFirstIteration ? imageAttachment : undefined
        );
        if (groqResponse.modelUsed) lastModelUsed = groqResponse.modelUsed;
        if (groqResponse.usage) {
          accumulatedPromptTokens += groqResponse.usage.promptTokens;
          accumulatedCompletionTokens += groqResponse.usage.completionTokens;
          accumulatedTotalTokens += groqResponse.usage.totalTokens;
        }

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
              const recurrence = fc.args.recurrence || 'none';
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
              const recurrenceLabel = recurrence === 'daily'
                ? ' | التكرار: يومياً (كل يوم) 🔄'
                : recurrence === 'weekly'
                ? ' | التكرار: أسبوعياً 🔄'
                : recurrence === 'monthly'
                ? ' | التكرار: شهرياً 🔄'
                : '';
              promptDetails = `الموضوع: "${fc.args.title || 'بدون عنوان'}" | الموعد: ${formattedTime}${recurrenceLabel}`;
            }

            const promptNotice = `هذا الإجراء يتطلب تأكيدك الصريح للمتابعة:
- العملية: ${tool.name === 'create_reminder' ? 'إنشاء تذكير جديد' : tool.name}
- التفاصيل: ${promptDetails}
يرجى التأكيد باستخدام الرمز: ${confirmation.token}`;

            await this.chatRepo.saveMessage(conversationId, 'assistant', 'Craft', promptNotice);

            const latencyMs = Date.now() - runStartTime;
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
              metrics: {
                modelUsed: lastModelUsed,
                latencyMs,
                promptTokens: accumulatedPromptTokens,
                completionTokens: accumulatedCompletionTokens,
                totalTokens: accumulatedTotalTokens,
              },
            };
          }

          // Guard against repeated search queries in the same conversation turn
          if (tool.name === 'web_search' && toolCallsExecuted.some((t) => t.toolName === 'web_search')) {
            logger.info('Repeated web_search prevented in Groq loop, sending direct synthesis prompt');
            // Use the previously gathered search result (last toolCallsExecuted entry with web_search)
            const prevSearchResult = toolCallsExecuted.find((t) => t.toolName === 'web_search')?.result || '';
            const prevSerialized = serializeToolResultForGroq('web_search', prevSearchResult);
            const directSynthesis: GroqMessage[] = [
              ...formatGroqConversationHistory(recentMessages, effectivePrompt),
              {
                role: 'user',
                content: `[نتائج البحث من المصادر المعتمدة]:\n${prevSerialized}\n\nبناءً على هذه النتائج، أجب عن سؤال المستخدم مباشرةً وبشكل واضح ودقيق. لا تبحث مرة أخرى.`,
              },
            ];
            const finalGroq = await this.groqProvider.generateReply(directSynthesis, false, memories);
            if (finalGroq.modelUsed) lastModelUsed = finalGroq.modelUsed;
            finalReply = finalGroq.text || 'تم معالجة طلبك بنجاح.';
            return null;
          }

          if (tool.name === 'web_search' && !interimSent) {
            await sendInterim('ثواني هبحثلك في المصادر وأتأكدلك من الموضوع ده وأرجعلك يا باشا 🔍');
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

          // Persist to tool_calls table in database for analytics & dashboard
          this.chatRepo
            .saveToolCall(
              agentRunId,
              conversationId,
              tool.name,
              fc.args,
              toolResult.output || null,
              toolResult.success ? 'success' : 'failed',
              toolResult.error
            )
            .catch((err) =>
              logger.warn('Failed to persist tool call to database', {
                error: err.message,
                toolName: tool.name,
              })
            );

          const serializedResult = serializeToolResultForGroq(
            tool.name,
            toolResult.output || toolResult.error
          );

          // Direct synthesis prompt to avoid Groq API 400 errors (tool choice none / model called a tool)
          const synthesisPrompt: GroqMessage[] = [
            ...formatGroqConversationHistory(recentMessages, effectivePrompt),
            {
              role: 'user',
              content: `[نتائج تنفيذ الأداة ${tool.name} الحالية من المصادر المعتمدة]:\n${serializedResult}\n\nالمطلوب منك كوكيل ذكي كرافت:\nبناءً على البيانات والنتائج الموثقة أعلاه، أجب عن سؤالي فوراً وبطريقة واضحة ومنظمة ومريحة للعين باللهجة المصرية الودودة.\nاذكر الأرقام والأسعار والمواصفات بالجنيه المصري (EGP) والدولار والموزعين كما وردت أعلاه بكل دقة ودون أي لف أو دوران.\nتحذير حاسم: إياك نهائياً أن تذكر كلمات تقنية مثل "RSS" أو "محرك البحث" أو "الـ API" أو "النتائج لم تذكر". تحدث كخبير تقني مباشر ومطلع على أحدث البيانات السوقية والموزعين.\nسعر الصرف الرسمي في مصر حوالي 48 إلى 50+ جنيه لكل دولار، لا تستخدم أسعار صرف قديمة إطلاقاً.`,
            },
          ];

          const synthesisRes = await this.groqProvider.generateReply(synthesisPrompt, false, memories);
          if (synthesisRes.modelUsed) lastModelUsed = synthesisRes.modelUsed;
          if (synthesisRes.usage) {
            accumulatedPromptTokens += synthesisRes.usage.promptTokens;
            accumulatedCompletionTokens += synthesisRes.usage.completionTokens;
            accumulatedTotalTokens += synthesisRes.usage.totalTokens;
          }

          finalReply = (synthesisRes.text || '').trim();
          return null;
        }

        finalReply = groqResponse.text || 'تم معالجة طلبك بنجاح.';
        return null;
      }
      return null;
    };

    // Unified AI Execution Strategy:
    // All tasks (conversations, search synthesis, tool calling, media) are processed via Groq infrastructure
    // Primary model -> Fallback model cascade with automatic key rotation
    try {
      const earlyReturn = await runGroqLoop();
      if (earlyReturn) return earlyReturn;
    } catch (groqErr: any) {
      logger.error('Groq LPU engine execution failed', {
        error: groqErr.message,
      });
      finalReply = 'يا باشا أنا معاك وسامعك، حصل تهنيجة بسيطة في الاتصال بس أنا جاهز، تحب أساعدك في إيه؟ 🤝';
    }

    if (
      !finalReply ||
      finalReply.trim().startsWith('Called tool:') ||
      finalReply.trim().startsWith('Tool [')
    ) {
      finalReply = 'يا باشا أنا معاك وسامعك، حصل تهنيجة بسيطة في الاتصال بس أنا جاهز، تحب أساعدك في إيه؟ 🤝';
    }

    // Clean and harmonize formatting for WhatsApp and mobile viewing (remove tables, <br>, etc.)
    finalReply = cleanWhatsAppText(finalReply);

    const latencyMs = Date.now() - runStartTime;

    // Prevent any late background interim messages from firing after final answer
    interimSent = true;

    // Persist assistant reply with full analytics metadata
    await this.chatRepo.saveMessage(
      conversationId,
      'assistant',
      'Craft',
      finalReply,
      undefined,
      {
        tokensUsed: accumulatedTotalTokens,
        promptTokens: accumulatedPromptTokens,
        completionTokens: accumulatedCompletionTokens,
        modelName: lastModelUsed,
        latencyMs,
        toolsUsed: toolCallsExecuted.map((t) => t.toolName).join(', ') || undefined,
      }
    );

    // Safe, non-blocking learning observer hook (Phase 5)
    // Observes completed AI responses and evaluates them for candidate cache eligibility without delaying user delivery.
    LearningPipeline.getInstance()
      .observeRun({
        runId: agentRunId,
        userInput: cleanUserText,
        replyText: finalReply,
        toolCalls: toolCallsExecuted,
        modelUsed: lastModelUsed,
        provider: 'groq',
        channel: input.channel,
      })
      .catch((learningErr) => {
        logger.debug('LearningPipeline background observer error (safely swallowed)', {
          error: learningErr.message,
        });
      });

    logger.info(`Agent run [${agentRunId}] completed successfully`);
    return {
      conversationId,
      agentRunId,
      status: 'completed',
      replyText: finalReply,
      toolCallsExecuted,
      metrics: {
        modelUsed: lastModelUsed,
        latencyMs,
        promptTokens: accumulatedPromptTokens,
        completionTokens: accumulatedCompletionTokens,
        totalTokens: accumulatedTotalTokens,
      },
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

      // Smart reminder execution exclusively via Groq
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
            const directSynth: GroqMessage[] = [
              { role: 'user', content: prompt },
              {
                role: 'user',
                content: `[نتيجة أداة ${tool.name}]:\n${serializeToolResultForGroq(
                  tool.name,
                  toolResult.output || toolResult.error
                )}\n\nصِغ رسالة التذكير النهائية الآن بأسلوب ودود باللهجة المصرية.`,
              },
            ];
            const synthRes = await this.groqProvider.generateReply(directSynth, false, memories);
            if (synthRes.text && synthRes.text.trim()) {
              return synthRes.text.trim();
            }
            break;
          }
        }

        if (reply.text && reply.text.trim()) {
          return reply.text.trim();
        }
        break;
      }
    } catch (err: any) {
      logger.warn('Failed to generate smart reminder content, falling back to default', {
        error: err.message,
      });
    }

    return `⏰ *تذكير من كرافت*:\n\n📌 *الموضوع*: "${reminderTitle}"\n\nحان الآن موعد هذا التذكير المحدد! أرجو أن تكون في أتم صحة وعافية.`;
  }
}
