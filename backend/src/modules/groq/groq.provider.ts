import { config } from '../../config/env';
import { logger } from '../../core/logger';
import { ToolRegistry } from '../tools/registry';

export interface GroqMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | any[];
  name?: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: {
      name: string;
      arguments: string;
    };
  }>;
}

export interface GroqMessageResponse {
  text: string;
  functionCalls?: Array<{
    id?: string;
    name: string;
    args: Record<string, any>;
  }>;
  modelUsed?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export class GroqProvider {
  private primaryModel: string;
  private fallbackModel: string;
  private whisperModel: string;
  private apiKey: string;

  private static cooldowns: Map<string, number> = new Map();
  private static readonly COOLDOWN_DURATION_MS = 5 * 60 * 1000; // 5 minutes

  public static isModelInCooldown(modelName: string): boolean {
    const expiry = GroqProvider.cooldowns.get(modelName);
    if (!expiry) return false;
    if (Date.now() > expiry) {
      GroqProvider.cooldowns.delete(modelName);
      return false;
    }
    return true;
  }

  public static setModelCooldown(modelName: string, durationMs = GroqProvider.COOLDOWN_DURATION_MS): void {
    GroqProvider.cooldowns.set(modelName, Date.now() + durationMs);
    logger.warn(
      `Groq Model [${modelName}] marked in cooldown for ${Math.round(durationMs / 1000)}s due to quota or rate limit`
    );
  }

  public static clearCooldowns(): void {
    GroqProvider.cooldowns.clear();
  }

  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs = 6000,
    errorMsg = 'Groq request timed out'
  ): Promise<T> {
    let timer: NodeJS.Timeout;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(errorMsg)), timeoutMs);
    });
    try {
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      clearTimeout(timer!);
    }
  }

  constructor(
    private toolRegistry: ToolRegistry = ToolRegistry.getInstance()
  ) {
    this.primaryModel = config.groq.primaryModel;
    this.fallbackModel = config.groq.fallbackModel;
    this.whisperModel = config.groq.whisperModel;
    this.apiKey = config.groq.apiKey;
  }

  public getSystemInstruction(memories?: string[]): string {
    const now = new Date();
    const cairoFormatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Africa/Cairo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    const parts = cairoFormatter.formatToParts(now);
    const getPart = (type: string) => parts.find((p) => p.type === type)?.value || '';
    const cairoNow = `${getPart('year')}-${getPart('month')}-${getPart('day')}T${getPart('hour')}:${getPart('minute')}:${getPart('second')}+03:00`;
    const today = `${getPart('year')}-${getPart('month')}-${getPart('day')}`;

    let instruction = `You are Craft, the personal AI assistant for the Craft ecosystem (available on Flutter mobile and WhatsApp).
Current User Timezone: Africa/Cairo (Egypt, UTC+3).
Current Exact Local Time in Cairo: ${cairoNow} (Date: ${today}, Time: ${getPart('hour')}:${getPart('minute')}).
Identity: Always introduce and refer to yourself as Craft. Never say you are ChatGPT, OpenAI, Groq, or Google.

Personality & Universal Linguistic Chameleon (تعدد اللهجات والذكاء اللغوي التكيفي):
- You are exceptionally intelligent, cultured, polite, concise, and friendly.
- Dynamic Dialect Mirroring: You dynamically and seamlessly adapt to the user's language and specific Arabic dialect:
  * Egyptian User (مصري): Speak warm, witty, natural Egyptian dialect (يا باشا، يا هندسة، تمام، زي الفل).
  * Saudi / Gulf User (سعودي / خليجي): Speak warm, respectful, natural Saudi/Gulf dialect (يا هلا والله، أبشر، تسلم، طال عمرك، ولا يهمك، تم).
  * Levantine User (أردني / سوري / لبناني / فلسطيني): Speak polite Levantine or clear courteous White Dialect (تكرم، يا هلا، على عيني، ولا يهمك).
  * Maghrebi User (مغربي / جزائري / تونسي): Understand their local dialect and terms, respond in clear accessible White Arabic or simplified formal Arabic.
  * Modern Standard Arabic (الفصحى): When the user communicates in MSA or requests it, respond in eloquent, accessible, modern Arabic.
  * English & Other Languages: Respond fluently and professionally in whatever language the user initiates.
- Memory Preference: If the user states a preferred dialect or name/job, remember it and mirror it consistently.

Universal Cultural Grounding & Deduction Protocol (التحقق الصامت الشامل ومنع الهبد):
- STRICT PROHIBITION: NEVER guess, fabricate, or hallucinate titles of movies, TV shows, actors, directors, songs, riddles, historical events, or local trivia from memory if not 100% certain!
- When asked to guess, identify, or answer about ANY creative or cultural work across ANY region or culture (Egyptian cinema, Saudi TV series, Syrian drama, Gulf arts, Hollywood films, anime, international history, regional proverbs, or riddles):
  * You MUST proactively invoke 'web_search' first before formulating your answer.
  * Colloquial Query Extraction: Convert the user's colloquial description or dialect clues into optimal search keywords:
    - Egyptian example: "فيلم عيل مسيحي ابوه مات وراح مدرسة حكومة" -> web_search query: "فيلم مصري طفل مسيحي مدرسة حكومية"
    - Saudi example: "مسلسل قديم للقصبي والسدحان يضحك" -> web_search query: "مسلسل سعودي ناصر القصبي عبدالله السدحان كوميدي"
    - Levantine example: "مسلسل بيئة شامية فيه حارة الضبع وابو عصام" -> web_search query: "مسلسل سوري بيئة شامية حارة الضبع ابو عصام"
    - Global example: "movie about astronaut growing potatoes on Mars" -> web_search query: "movie astronaut trapped Mars growing potatoes"
  * Ground your answer strictly on the verified search results (mention title, release year, stars/director).
- Interactive Human-like Deduction:
  * If the search yields ambiguous results or multiple candidates, do NOT make up fake titles.
  * Act like an intelligent, friendly human playing a guessing game: mention the closest possibilities and ask smart narrowing questions (e.g. "هل العمل نزل قبل ولا بعد 2015؟ فاكر مين كان البطل أو المخرج؟") to deduce it together.

Multimodal Vision, Audio & Document Intelligence:
- You possess full visual, auditory, and document perception. You can analyze images, listen to audio voice notes, and inspect documents and code.
- You can inspect, read, analyze, and debug any code and documents sent to you (PDF, Word .docx, Dart .dart, Markdown .md, JSON, YAML, etc.). Provide clear, structured, and helpful answers or code solutions.

Tools & Web Search:
- You have access to tools for current time, weather, web search, creating reminders, listing reminders, completing reminders, and saving memory facts.
- Live Web Search (web_search):
  * Proactively invoke 'web_search' whenever the user asks about:
    - Culture, riddles, guessing games, movies, series, songs, books, or historical facts from any country.
    - New or upcoming devices, foldable phones, leaks, rumors, or specs (e.g. iPhone Duo, iPhone Fold, iPhone 18, new chips).
    - Current market prices, local costs, or currency exchange rates in any country (e.g. أسعار الذهب، العملات، أسعار الموبايلات).
    - Recent news, breaking events, matches, or when the user asks you to search.
  * SINGLE SEARCH EFFICIENCY RULE: Invoke 'web_search' once with the most relevant keywords. Once search results are returned, immediately synthesize your answer and reply to the user without calling web_search again!
  * Always ground your answer in the retrieved real-time web results to provide an up-to-date, accurate, and factual answer!
- When creating a reminder (create_reminder):
  * Calculate the target time accurately from the current Cairo time (${cairoNow}).
  * If the user says "بعد دقيقة" (in 1 minute), add 1 minute to ${cairoNow}.
  * Always provide the 'time' argument as an ISO 8601 string including the Cairo offset '+03:00' (e.g. YYYY-MM-DDTHH:mm:00+03:00).
  * Recurring Reminders (التذكيرات المتكررة):
    - You FULLY support recurring reminders! NEVER tell the user that recurring reminders are unsupported.
    - If the user specifies recurrence (e.g. "كل يوم", "يومياً", "كل صباح", "كل أسبوع", "أسبوعياً", "كل شهر", "شهرياً"), ALWAYS set the 'recurrence' argument to 'daily', 'weekly', or 'monthly'.
    - For recurring reminders, set 'time' to the first upcoming occurrence date/time (e.g. if user asks for daily reminder at 12:00 PM, set time to today at 12:00 PM if still in future, or tomorrow at 12:00 PM if 12:00 has already passed in Cairo).
    - If no recurrence is mentioned, leave 'recurrence' as 'none'.
- When the user asks to see or list their reminders/tasks, invoke 'list_reminders'.
- When the user marks a task or reminder as done/finished, invoke 'complete_reminder'.
- When the user shares personal details about themselves (such as job, profession, dialect preference, name, location, or hobbies), invoke 'save_memory' to persist it permanently.
- Always remember details mentioned in previous turns of the conversation and the stored long-term memory below. Reference them naturally and answer immediately when asked about them!

Mobile & WhatsApp Elegant Formatting Rules:
- STRICT PROHIBITION: NEVER use Markdown tables (| column | column |). WhatsApp does not support markdown tables and renders them as an ugly, broken mess on phone screens.
- When presenting comparisons, specifications, or structured data (such as phone specs, pricing, features, lists), ALWAYS format them using clean, elegant bullet points (• or emojis like 📱, ⚡, 💰, 📌) with bold labels (e.g. *الشاشة*: 6.7 بوصة).
- NEVER output raw HTML tags like <br>, <div>, or <b>. Always use standard clean line breaks (\n\n).
- WhatsApp native styling: Use *bold* for headings and key terms, _italic_ for brief notes.
- Organization & Readability: Avoid overwhelming continuous walls of text. When giving comprehensive or long answers, organize the response into 2 to 3 clearly spaced, comfortable sections (e.g., مقدمة سريعة، ثم التفاصيل في نقاط منظمة ومريحة للعين، ثم خلاصة أو نصيحة ختامية).`;

    if (memories && memories.length > 0) {
      instruction += `\n\n### الذاكرة طويلة المدى المحفوظة عن المستخدم (Stored Long-Term Profile & Facts):\n${memories.map((m) => `- ${m}`).join('\n')}\n(تذكر هذه الحقائق دائماً وبدقة تامة، ولا تسأل المستخدم عن أي معلومة مذكورة هنا أبداً بل أجب مباشرة وبثقة بناءً عليها!)`;
    }

    return instruction;
  }

  /**
   * Transcribes WhatsApp voice notes (OGG, MP3, WAV, AAC) using Groq Whisper Large V3 Turbo
   */
  public async transcribeAudio(
    audioBuffer: Buffer,
    mimeType = 'audio/ogg',
    filename = 'voice_note.ogg'
  ): Promise<string> {
    if (config.groq.isMockMode || !this.apiKey) {
      return 'رسالة صوتية من المستخدم (Mock Audio Transcription)';
    }

    try {
      logger.info(`Transcribing audio with Groq Whisper (${audioBuffer.length} bytes, mime: ${mimeType})`);
      const form = new FormData();
      form.append('model', this.whisperModel);
      form.append('language', 'ar');
      form.append('prompt', 'تسجيل صوتي مصري لوكيل كرافت الذكي');

      const blob = new Blob([audioBuffer], { type: mimeType });
      form.append('file', blob, filename);

      const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: form,
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error('Groq Whisper API returned error', { status: response.status, error: errorText });
        return '';
      }

      const data: any = await response.json();
      const transcribedText = (data.text || '').trim();
      logger.info(`Successfully transcribed audio via Groq Whisper: "${transcribedText}"`);
      return transcribedText;
    } catch (err: any) {
      logger.error('Exception transcribing audio with Groq Whisper', { error: err.message });
      return '';
    }
  }

  /**
   * Generates a conversational or tool-calling response via Groq LPU models
   */
  public async generateReply(
    messages: GroqMessage[],
    useTools = true,
    memories?: string[],
    imageAttachment?: { data: string; mimeType: string }
  ): Promise<GroqMessageResponse> {
    if (config.groq.isMockMode || !this.apiKey) {
      const mockRes = this.generateMockResponse(messages, memories, !!imageAttachment);
      if (!mockRes.modelUsed) mockRes.modelUsed = this.primaryModel;
      if (!mockRes.usage) {
        mockRes.usage = { promptTokens: 30, completionTokens: 40, totalTokens: 70 };
      }
      return mockRes;
    }

    // If an image is attached, route directly to Qwen 3.8 27B which has native vision support
    if (imageAttachment) {
      try {
        logger.info(`Image detected, routing directly to Groq Vision model [${this.fallbackModel}]`);
        return await this.withTimeout(
          this.callChat(this.fallbackModel, messages, useTools, memories, imageAttachment),
          7000,
          `Groq Vision model [${this.fallbackModel}] timed out after 7s`
        );
      } catch (err: any) {
        logger.error(`Groq Vision call with [${this.fallbackModel}] failed`, { error: err.message });
        throw err;
      }
    }

    // Text & tools: Primary model (openai/gpt-oss-120b) with automatic fallback (qwen/qwen3.8-27b)
    if (!GroqProvider.isModelInCooldown(this.primaryModel)) {
      try {
        return await this.withTimeout(
          this.callChat(this.primaryModel, messages, useTools, memories),
          5000,
          `Primary Groq model [${this.primaryModel}] timed out after 5s`
        );
      } catch (primaryErr: any) {
        const isQuotaOrRateLimit =
          primaryErr.message?.includes('429') ||
          primaryErr.message?.includes('rate_limit_exceeded') ||
          primaryErr.message?.includes('timed out');
        if (isQuotaOrRateLimit) {
          GroqProvider.setModelCooldown(this.primaryModel);
        }
        logger.warn(
          `Primary Groq model [${this.primaryModel}] failed, falling back to [${this.fallbackModel}]`,
          { error: primaryErr.message }
        );
      }
    } else {
      logger.debug(`Skipping primary Groq model [${this.primaryModel}] — currently in cooldown`);
    }

    if (!GroqProvider.isModelInCooldown(this.fallbackModel)) {
      try {
        return await this.withTimeout(
          this.callChat(this.fallbackModel, messages, useTools, memories),
          5000,
          `Fallback Groq model [${this.fallbackModel}] timed out after 5s`
        );
      } catch (fallbackErr: any) {
        const isQuotaOrRateLimit =
          fallbackErr.message?.includes('429') ||
          fallbackErr.message?.includes('rate_limit_exceeded') ||
          fallbackErr.message?.includes('timed out');
        if (isQuotaOrRateLimit) {
          GroqProvider.setModelCooldown(this.fallbackModel);
        }
        logger.error(`Fallback Groq model [${this.fallbackModel}] also failed`, {
          error: fallbackErr.message,
        });
        throw fallbackErr;
      }
    }

    throw new Error('All configured Groq models are currently in cooldown or unavailable');
  }

  private async callChat(
    modelName: string,
    messages: GroqMessage[],
    useTools: boolean,
    memories?: string[],
    imageAttachment?: { data: string; mimeType: string }
  ): Promise<GroqMessageResponse> {
    const systemPrompt = this.getSystemInstruction(memories);

    // Format messages for Groq / OpenAI API
    const formattedMessages: GroqMessage[] = [];

    // Prepend system message
    formattedMessages.push({
      role: 'system',
      content: systemPrompt,
    });

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      const isLastUserTurn = i === messages.length - 1 && msg.role === 'user';

      if (isLastUserTurn && imageAttachment) {
        const textContent = typeof msg.content === 'string' ? msg.content : '';
        formattedMessages.push({
          role: 'user',
          content: [
            { type: 'text', text: textContent || 'اشرح وحلل ما في هذه الصورة بدقة' },
            {
              type: 'image_url',
              image_url: {
                url: `data:${imageAttachment.mimeType};base64,${imageAttachment.data}`,
              },
            },
          ],
        });
      } else {
        formattedMessages.push(msg);
      }
    }

    const payload: Record<string, any> = {
      model: modelName,
      messages: formattedMessages,
      max_tokens: 800,
      temperature: 0.7,
    };

    if (useTools) {
      payload.tools = this.toolRegistry.getOpenAITools();
      payload.tool_choice = 'auto';
    }

    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Groq API Error (${res.status}): ${errText}`);
    }

    const data: any = await res.json();
    const choice = data.choices?.[0];
    const assistantMsg = choice?.message;

    if (!assistantMsg) {
      throw new Error('Groq API returned empty choices array');
    }

    const usage = data.usage
      ? {
          promptTokens: data.usage.prompt_tokens || 0,
          completionTokens: data.usage.completion_tokens || 0,
          totalTokens: data.usage.total_tokens || 0,
        }
      : undefined;

    // Check for tool calls
    if (assistantMsg.tool_calls && assistantMsg.tool_calls.length > 0) {
      const parsedToolCalls = assistantMsg.tool_calls.map((tc: any) => {
        let parsedArgs: Record<string, any> = {};
        try {
          parsedArgs = JSON.parse(tc.function.arguments || '{}');
        } catch {
          parsedArgs = {};
        }
        return {
          id: tc.id,
          name: tc.function.name,
          args: parsedArgs,
        };
      });

      return {
        text: assistantMsg.content || '',
        functionCalls: parsedToolCalls,
        modelUsed: modelName,
        usage,
      };
    }

    return {
      text: assistantMsg.content || '',
      modelUsed: modelName,
      usage,
    };
  }

  /**
   * Deterministic mock engine for offline unit tests and CI
   */
  public generateMockResponse(
    messages: GroqMessage[],
    memories?: string[],
    hasImage = false
  ): GroqMessageResponse {
    const lastMsg = messages[messages.length - 1];
    const lastContent = typeof lastMsg?.content === 'string' ? lastMsg.content : '';
    const allUserTexts = messages
      .filter((m) => m.role === 'user' || m.role === 'tool')
      .map((m) => (typeof m.content === 'string' ? m.content : ''))
      .join(' ');

    if (hasImage) {
      return {
        text: 'لقد اطلعت على الصورة المرفقة بعناية عبر Groq Vision! إنها واضحة ومميزة، وأستطيع رؤية تفاصيلها بالكامل. كيف تحب أن أساعدك فيها؟',
      };
    }

    if (
      lastContent.includes('تسجيل صوتي') ||
      lastContent.includes('صوتية') ||
      lastContent.includes('voice_note')
    ) {
      return {
        text: 'سمعت تسجيلك الصوتي وفهمت طلبك بالكامل يا هندسة! جاهز لمساعدتك وتنفيذ ما طلبته فوراً.',
      };
    }

    if (lastContent.includes('Word') || lastContent.includes('.docx')) {
      return {
        text: 'لقد قرأت ملف الـ Word المرفق واطلعت على محتواه النصي بالكامل بنجاح عبر Groq. جاهز لمساعدتك فيه ومناقشة تفاصيله!',
      };
    }

    if (
      lastContent.includes('ملف برمجي') ||
      lastContent.includes('كود برمجي') ||
      lastContent.includes('.dart')
    ) {
      return {
        text: 'لقد فحصت الكود البرمجي المرفق بعناية عبر Groq. الكود منظم وجاهز لمساعدتك في شرحه أو تعديله أو حل المشاكل فيه يا هندسة!',
      };
    }

    // Smart reminder trigger
    if (allUserTexts.includes('[نظام التذكيرات الذكية]')) {
      const reminderMatch = allUserTexts.match(/عنوان التذكير: "([^"]+)"/);
      const reminderTopic = reminderMatch ? reminderMatch[1] : 'التذكير المحدد';

      if (lastMsg?.role === 'tool' || lastContent.includes('result:')) {
        if (allUserTexts.includes('weather') || allUserTexts.includes('Cairo')) {
          return {
            text: `⏰ *تذكير من كرافت*:\n\n📌 *بخصوص حالة الطقس في القاهرة*:\nدرجة الحرارة حالياً 28°C والجو مشمس ومعتدل في القاهرة اليوم. يومك سعيد وموفق يا هندسة!`,
          };
        }
        return {
          text: `⏰ *تذكير من كرافت*:\n\n📌 حان موعد: "${reminderTopic}".\nأرجو أن تكون في أتم صحة وعافية!`,
        };
      }

      if (
        reminderTopic.includes('طقس') ||
        reminderTopic.includes('الجو') ||
        reminderTopic.includes('weather')
      ) {
        return {
          text: '',
          functionCalls: [{ id: 'fc_mock_weather', name: 'get_weather', args: { city: 'Cairo' } }],
        };
      }

      return {
        text: `⏰ *تذكير من كرافت*:\n\n📌 حان الآن موعد: "${reminderTopic}".\nأرجو أن تكون في أتم صحة وعافية، وبالتوفيق دائماً!`,
      };
    }

    // Tool observation reply
    if (lastMsg?.role === 'tool') {
      return {
        text: `بناءً على الأداة المستخدمة، النتيجة هي: ${lastContent}`,
      };
    }

    const lower = lastContent.toLowerCase();
    const hasFlutterMemory =
      (memories && memories.some((m) => m.toLowerCase().includes('flutter'))) ||
      allUserTexts.toLowerCase().includes('flutter') ||
      allUserTexts.includes('مبرمج');

    if (
      lower.includes('شغلانتي') ||
      lower.includes('وظيفتي') ||
      lower.includes('عملي') ||
      lower.includes('شغال ايه') ||
      lower.includes('شغال إيه') ||
      lower.includes('فاكر')
    ) {
      if (hasFlutterMemory) {
        return {
          text: 'طبعاً فاكر يا هندسة! إنت مطور تطبيقات فلاتر (Flutter Developer)، وزي ما اتفقنا إحنا زملاء عمل في نفس المجال. محتاج مساعدة في كود أو مشروع معين؟',
        };
      }
    }

    if (lower.includes('time') || lower.includes('ساعة') || lower.includes('وقت')) {
      return {
        text: '',
        functionCalls: [{ id: 'fc_mock_time', name: 'get_current_time', args: {} }],
      };
    }

    if (lower.includes('weather') || lower.includes('طقس') || lower.includes('جو')) {
      return {
        text: '',
        functionCalls: [{ id: 'fc_mock_weather', name: 'get_weather', args: { city: 'Cairo' } }],
      };
    }

    if (
      lower.includes('search') ||
      lower.includes('بحث') ||
      lower.includes('اخبار') ||
      lower.includes('فيلم') ||
      lower.includes('مسلسل') ||
      lower.includes('خمن') ||
      lower.includes('خمّن')
    ) {
      return {
        text: '',
        functionCalls: [
          { id: 'fc_mock_search', name: 'web_search', args: { query: lastContent || 'Craft AI updates' } },
        ],
      };
    }

    if (
      lower.includes('list_remind') ||
      lower.includes('قائمة التذكير') ||
      lower.includes('تذكيراتي') ||
      lower.includes('عرض التذكير') ||
      lower.includes('مهامي')
    ) {
      return {
        text: '',
        functionCalls: [{ id: 'fc_mock_list', name: 'list_reminders', args: {} }],
      };
    }

    if (
      lower.includes('complete_remind') ||
      lower.includes('إتمام') ||
      lower.includes('انتهيت') ||
      lower.includes('خلصت') ||
      lower.includes('تم التذكير')
    ) {
      return {
        text: '',
        functionCalls: [
          { id: 'fc_mock_complete', name: 'complete_reminder', args: { title: 'اجتماع' } },
        ],
      };
    }

    if (
      lower.includes('remind') ||
      lower.includes('تذكير') ||
      lower.includes('ذكر') ||
      lower.includes('فكر') ||
      lower.includes('نبه')
    ) {
      return {
        text: '',
        functionCalls: [
          {
            id: 'fc_mock_remind',
            name: 'create_reminder',
            args: { title: 'Craft Agent Review', time: 'tomorrow' },
          },
        ],
      };
    }

    // Default conversational reply
    return {
      text: 'أهلاً بك! أنا Craft، وكيلك الذكي الشخصي المدعوم بمحرك Groq الفائق. كيف يمكنني مساعدتك اليوم؟',
    };
  }

  /**
   * Ultra-fast intent classifier & contextual interim acknowledgment generator (~150ms).
   * Determines if the user's prompt requires web research, live facts, or checking external info.
   * If yes: returns a natural, short 1-sentence acknowledgement in the user's dialect (e.g. "هتأكدلك من كذا دلوقتي يا باشا").
   * If no: returns null.
   */
  public async generateInterimAcknowledgement(userPrompt: string): Promise<string | null> {
    if (!userPrompt || userPrompt.trim().length === 0) {
      return null;
    }

    const cleanPrompt = userPrompt.trim();

    // Mock Mode support for deterministic unit tests
    if (process.env.GEMINI_MOCK_MODE === 'true') {
      const lower = cleanPrompt.toLowerCase();
      const needsSearch =
        lower.includes('بحث') ||
        lower.includes('ابحث') ||
        lower.includes('دور') ||
        lower.includes('سعر') ||
        lower.includes('موقع') ||
        lower.includes('أخبار') ||
        lower.includes('اخبار') ||
        lower.includes('search');

      if (needsSearch) {
        if (lower.includes('سعر')) {
          return 'ثواني هشوفلك الأسعار في السوق دلوقتي وأرجعلك.';
        }
        if (lower.includes('موقع')) {
          return 'هتأكدلك من المواقع المتاحة دلوقتي يا باشا.';
        }
        return 'ثواني هبحثلك في المصادر وأرجعلك في ثواني يا باشا.';
      }
      return null;
    }

    if (!this.apiKey) {
      return null;
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 1500); // 1.5s hard ceiling

      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.fallbackModel || 'qwen/qwen3.8-27b', // Qwen 27B gives ~140ms latency
          messages: [
            {
              role: 'system',
              content: `You are Craft, a smart, lightning-fast personal AI assistant.
Analyze the user's message to determine if it requires web research, external lookup, live data, or checking facts/links.
- If YES: generate an ultra-fast, natural 1-sentence acknowledgement in the SAME language and dialect as the user (e.g. Egyptian: "هتأكدلك من أقرب مكان مجاني دلوقتي يا باشا", Saudi/Gulf: "أبشر، بشوفلك أفضل لابتوب الحين وأرجعلك", Levantine: "ثواني بشوفلك الأسعار وبرجعلك", English: "Let me check that for you right away!").
Rules: Maximum 8-10 words. Do NOT answer the question. Only acknowledge what you are about to check.
- If NO (chit-chat, greeting, general reasoning, math, simple questions): return exactly "NONE".`,
            },
            {
              role: 'user',
              content: cleanPrompt,
            },
          ],
          max_tokens: 35,
          temperature: 0.3,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        return null;
      }

      const data: any = await response.json();
      const reply = data.choices?.[0]?.message?.content?.trim();

      if (!reply || reply === 'NONE' || reply.toUpperCase().startsWith('NONE') || reply.length < 3) {
        return null;
      }

      // Remove any surrounding quotes
      const cleaned = reply.replace(/^["'«“]+|["'»”]+$/g, '').trim();
      return cleaned;
    } catch (err: any) {
      logger.debug('Groq interim acknowledgement generation skipped/timed out', { error: err.message });
      return null;
    }
  }
}
