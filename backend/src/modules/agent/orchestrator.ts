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
import { UserRepository } from '../../database/repositories/user.repo';
import { FAQCache } from '../cache/faq_cache';
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
  conversationId?: string;
  channel: 'flutter' | 'whatsapp';
  text: string;
  mediaUrl?: string;
  media?: AgentMediaAttachment;
  onInterimProgress?: (message: string) => Promise<void> | void;
}

export function shouldRouteToGemini(text: string, hasMedia: boolean): boolean {
  if (hasMedia) return true;
  if (!text) return false;
  const lower = text.toLowerCase();
  const heavyKeywords = [
    'سعر',
    'اسعار',
    'أسعار',
    'كام',
    'بكام',
    'جنيه',
    'دولار',
    'مواصفات',
    'مواصفاته',
    'مواصفاتها',
    'ابحث',
    'دورلي',
    'سيرش',
    'اخبار',
    'أخبار',
    'طقس',
    'الجو',
    'احدث',
    'أحدث',
    'مقارنة',
    'قارن',
    'فيلم',
    'مسلسل',
    'اغنية',
    'أغنية',
    'ممثل',
    'مخرج',
    'ذهب',
    'عيار',
    'بورصة',
    'عملات',
    'سعر الدولار',
  ];
  return heavyKeywords.some((kw) => lower.includes(kw));
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

  // Limit to most recent 4 messages to optimize latency and TTFT
  const slicedMessages = messages.slice(-4);

  for (const m of slicedMessages) {
    let text = m.text?.trim();
    if (!text || text.includes('Called tool:') || text.startsWith('Tool [')) continue;
    const role: 'user' | 'model' = m.senderRole === 'user' ? 'user' : 'model';
    if (role === 'model' && text.length > 350) {
      text = text.substring(0, 350) + '...';
    }
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
    private geminiProvider: GeminiProvider = new GeminiProvider(),
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

    let lastModelUsed = config.gemini.model;
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

    // 0. FAQ & Semantic Cache Check (0 tokens, latency <5ms)
    if (!input.media && cleanUserText) {
      const faqMatch = FAQCache.getInstance().match(cleanUserText);
      if (faqMatch.matched && faqMatch.response) {
        logger.info(`FAQ Cache hit for input "${cleanUserText}" [intent: ${faqMatch.intent}] - 0 tokens`);
        const conversation = await this.chatRepo.getOrCreateConversation(input.userId, input.channel);
        const conversationId = conversation.id;

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
            faqMatch.response,
            undefined,
            {
              tokensUsed: 0,
              promptTokens: 0,
              completionTokens: 0,
              modelName: 'faq-cache',
              latencyMs: Date.now() - runStartTime,
            }
          ),
        ]);

        return {
          conversationId,
          agentRunId,
          status: 'completed',
          replyText: faqMatch.response,
          toolCallsExecuted: [],
          metrics: {
            modelUsed: 'faq-cache',
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
    const { effectivePrompt, mediaPart, historyRecordText } = await processMediaAttachment(
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

    const runGeminiLoop = async (): Promise<AgentRunOutput | null> => {
      const contents: Content[] = formatConversationHistory(
        recentMessages,
        effectivePrompt,
        mediaPart
      );

      let geminiIterations = 0;
      while (geminiIterations < config.security.maxIterations) {
        geminiIterations++;
        logger.debug(`Agent Gemini ReAct iteration [${geminiIterations}/${config.security.maxIterations}]`);

        const isFirstIteration = geminiIterations === 1;
        const geminiResponse = await this.geminiProvider.generateReply(contents, isFirstIteration, memories);
        if (geminiResponse.modelUsed) lastModelUsed = geminiResponse.modelUsed;
        if (geminiResponse.usage) {
          accumulatedPromptTokens += geminiResponse.usage.promptTokens;
          accumulatedCompletionTokens += geminiResponse.usage.completionTokens;
          accumulatedTotalTokens += geminiResponse.usage.totalTokens;
        }

        if (geminiResponse.functionCalls && geminiResponse.functionCalls.length > 0) {
          const fc = geminiResponse.functionCalls[0];
          const tool = this.toolRegistry.getTool(fc.name);

          if (!tool) {
            contents.push({
              role: 'user',
              parts: [{ text: `تنبيه: الأداة [${fc.name}] غير متوفرة، يرجى الإجابة مباشرة بدونها.` }],
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
            logger.info('Repeated web_search prevented in Gemini loop, requesting immediate finalization');
            contents.push({
              role: 'user',
              parts: [
                {
                  text: 'تم جلب نتائج البحث في الخطوة السابقة بالفعل. صِغ ردك النهائي الشامل للمستخدم الآن فوراً باللهجة المصرية بناءً على النتائج المتاحة.',
                },
              ],
            });
            const finalGemini = await this.geminiProvider.generateReply(contents, false, memories);
            if (finalGemini.modelUsed) lastModelUsed = finalGemini.modelUsed;
            const text = (finalGemini.text || '').trim();
            finalReply =
              text && !text.startsWith('Called tool:') && !text.startsWith('Tool [')
                ? text
                : 'تم معالجة طلبك بنجاح.';
            return null;
          }

          if (tool.name === 'web_search' && !interimSent) {
            await sendInterim('ثواني هبحثلك في المصادر وأتأكدلك من الموضوع ده وأرجعلك يا باشا 🔍');
          }

          logger.info(`Executing tool [${tool.name}] via Gemini`, { args: fc.args });
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

          // Once tool finishes execution, serialize output and synthesize immediate final response
          const serializedResult = serializeToolResultForGroq(
            tool.name,
            toolResult.output || toolResult.error
          );

          contents.push({
            role: 'user',
            parts: [
              {
                text: `[نتائج تنفيذ الأداة ${tool.name} الحالية من المصادر المعتمدة]:\n${serializedResult}\n\nالمطلوب منك كوكيل ذكي كرافت:\nبناءً على البيانات والنتائج الموثقة أعلاه، أجب عن سؤالي فوراً وبطريقة واضحة ومنظمة ومريحة للعين باللهجة المصرية الودودة.\nاذكر الأرقام والأسعار والمواصفات بالجنيه المصري (EGP) والدولار والموزعين كما وردت أعلاه بكل دقة ودون أي لف أو دوران.\nتحذير حاسم: إياك نهائياً أن تذكر كلمات تقنية مثل "RSS" أو "محرك البحث" أو "الـ API" أو "النتائج لم تذكر". تحدث كخبير تقني مباشر ومطلع على أحدث البيانات السوقية والموزعين.\nسعر الصرف الرسمي في مصر حوالي 48 إلى 50+ جنيه لكل دولار، لا تستخدم أسعار صرف قديمة إطلاقاً.`,
              },
            ],
          });

          let candidateReply = '';
          try {
            const synthesisResponse = await this.geminiProvider.generateReply(contents, false, memories);
            if (synthesisResponse.modelUsed) lastModelUsed = synthesisResponse.modelUsed;
            if (synthesisResponse.usage) {
              accumulatedPromptTokens += synthesisResponse.usage.promptTokens;
              accumulatedCompletionTokens += synthesisResponse.usage.completionTokens;
              accumulatedTotalTokens += synthesisResponse.usage.totalTokens;
            }
            candidateReply = (synthesisResponse.text || '').trim();
          } catch (geminiSynthErr: any) {
            logger.warn('Gemini synthesis failed, falling back to Groq LPU for instant synthesis', {
              error: geminiSynthErr.message,
            });
            try {
              const groqRes = await this.groqProvider.generateReply(
                [
                  ...formatGroqConversationHistory(recentMessages, effectivePrompt),
                  {
                    role: 'user',
                    content: `[نتائج تنفيذ الأداة ${tool.name} الحالية من المصادر المعتمدة]:\n${serializedResult}\n\nالمطلوب منك كوكيل ذكي كرافت:\nبناءً على البيانات والنتائج الموثقة أعلاه، أجب عن سؤالي فوراً وبطريقة واضحة ومنظمة ومريحة للعين باللهجة المصرية الودودة.\nاذكر الأرقام والأسعار والمواصفات بالجنيه المصري (EGP) والدولار والموزعين كما وردت أعلاه بكل دقة ودون أي لف أو دوران.\nتحذير حاسم: إياك نهائياً أن تذكر كلمات تقنية مثل "RSS" أو "محرك البحث" أو "الـ API" أو "النتائج لم تذكر". تحدث كخبير تقني مباشر ومطلع على أحدث البيانات السوقية والموزعين.\nسعر الصرف الرسمي في مصر حوالي 48 إلى 50+ جنيه لكل دولار، لا تستخدم أسعار صرف قديمة إطلاقاً.`,
                  },
                ],
                false,
                memories
              );
              if (groqRes.modelUsed) lastModelUsed = groqRes.modelUsed;
              candidateReply = (groqRes.text || '').trim();
            } catch (groqSynthErr: any) {
              logger.error('Both Gemini and Groq synthesis failed', {
                geminiError: geminiSynthErr.message,
                groqError: groqSynthErr.message,
              });
            }
          }

          if (
            candidateReply &&
            !candidateReply.startsWith('Called tool:') &&
            !candidateReply.startsWith('Tool [')
          ) {
            finalReply = candidateReply;
            return null;
          }

          // Fallback finalizer if candidate reply was invalid or leaked
          const fallbackContents = [
            ...contents.slice(0, -1),
            {
              role: 'user',
              parts: [
                {
                  text: `البيانات المتاحة من المصادر:\n${serializedResult}\n\nأجب عن السؤال الآن بأسلوبك الودود بالعامية المصرية مع ذكر الأرقام والأسعار فوراً.`,
                },
              ],
            },
          ];
          try {
            const secondAttempt = await this.geminiProvider.generateReply(fallbackContents, false, memories);
            if (
              secondAttempt.text &&
              !secondAttempt.text.trim().startsWith('Called tool:') &&
              !secondAttempt.text.trim().startsWith('Tool [')
            ) {
              finalReply = secondAttempt.text.trim();
            } else {
              finalReply = 'تم العثور على التفاصيل والأسعار المطلوبة من المصادر الرسمية، وبناءً على البيانات الحالية فإن التفاصيل متاحة لدى الموزعين المعتمدين.';
            }
          } catch {
            finalReply = 'تم العثور على التفاصيل والأسعار المطلوبة من المصادر الرسمية، وبناءً على البيانات الحالية فإن التفاصيل متاحة لدى الموزعين المعتمدين.';
          }
          return null;
        }

        const candidateText = (geminiResponse.text || '').trim();
        if (
          candidateText &&
          !candidateText.startsWith('Called tool:') &&
          !candidateText.startsWith('Tool [')
        ) {
          finalReply = candidateText;
        } else {
          finalReply = 'تم معالجة طلبك بنجاح.';
        }
        return null;
      }
      return null;
    };

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

    // Routing Strategy:
    // Heavy tasks (multimodal media, search, prices, specs) -> Gemini (2 keys pool)
    // Conversational & general turns (80% of turns) -> Groq LPU (4 keys pool)
    const isHeavy = shouldRouteToGemini(textToProcess, !!input.media);
    const preferGemini = isHeavy || process.env.PRIMARY_LLM_PROVIDER === 'gemini';

    logger.info(`Routing decision: isHeavyTask=${isHeavy}, preferGemini=${preferGemini}`);

    if (preferGemini) {
      try {
        const earlyReturn = await runGeminiLoop();
        if (earlyReturn) return earlyReturn;
      } catch (geminiErr: any) {
        logger.warn('Gemini provider failed or encountered rate limit, falling back to Groq LPU engine', {
          error: geminiErr.message,
        });
        try {
          const earlyReturn = await runGroqLoop();
          if (earlyReturn) return earlyReturn;
        } catch (groqFallbackErr: any) {
          logger.error('Both Gemini and Groq engines failed during agent execution', {
            geminiError: geminiErr.message,
            groqError: groqFallbackErr.message,
          });
          finalReply = 'يا باشا أنا معاك وسامعك، حصل تهنيجة بسيطة في الاتصال بس أنا جاهز، تحب أساعدك في إيه؟ 🤝';
        }
      }
    } else {
      try {
        const earlyReturn = await runGroqLoop();
        if (earlyReturn) return earlyReturn;
      } catch (groqErr: any) {
        logger.warn('Groq LPU engine failed or encountered rate limit, falling back to Gemini engine', {
          error: groqErr.message,
        });
        try {
          const earlyReturn = await runGeminiLoop();
          if (earlyReturn) return earlyReturn;
        } catch (geminiFallbackErr: any) {
          logger.error('Both Groq and Gemini engines failed during agent execution', {
            groqError: groqErr.message,
            geminiError: geminiFallbackErr.message,
          });
          finalReply = 'يا باشا أنا معاك وسامعك، حصل تهنيجة بسيطة في الاتصال بس أنا جاهز، تحب أساعدك في إيه؟ 🤝';
        }
      }
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

      // Try GeminiProvider first (Gemini 3.6 Flash)
      try {
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
              contents.push({
                role: 'user',
                parts: [
                  {
                    text: `[نتيجة أداة ${tool.name}]:\n${serializeToolResultForGroq(
                      tool.name,
                      toolResult.output || toolResult.error
                    )}\n\nصِغ رسالة التذكير النهائية الآن بأسلوب ودود باللهجة المصرية.`,
                  },
                ],
              });
              const reminderRes = await this.geminiProvider.generateReply(contents, false, memories);
              if (reminderRes.text && reminderRes.text.trim()) {
                return reminderRes.text.trim();
              }
              continue;
            }
          }

          if (reply.text && reply.text.trim()) {
            return reply.text.trim();
          }
          break;
        }
      } catch (geminiErr: any) {
        logger.warn('Gemini failed for smart reminder, attempting Groq fallback', {
          error: geminiErr.message,
        });

        // Groq Fallback
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
                content: serializeToolResultForGroq(tool.name, toolResult.output || toolResult.error),
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
