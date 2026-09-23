import { GoogleGenerativeAI, Content } from '@google/generative-ai';
import { config } from '../../config/env';
import { logger } from '../../core/logger';
import { ToolRegistry } from '../tools/registry';

export interface GeminiMessageResponse {
  text: string;
  functionCalls?: Array<{
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

export class GeminiProvider {
  private genAI: GoogleGenerativeAI | null = null;
  private primaryModel: string;
  private fallbackModel: string;

  private static cooldowns: Map<string, number> = new Map();
  private static readonly COOLDOWN_DURATION_MS = 30 * 1000; // 30 seconds

  public static isModelInCooldown(modelName: string): boolean {
    const expiry = GeminiProvider.cooldowns.get(modelName);
    if (!expiry) return false;
    if (Date.now() > expiry) {
      GeminiProvider.cooldowns.delete(modelName);
      return false;
    }
    return true;
  }

  public static setModelCooldown(modelName: string, durationMs = GeminiProvider.COOLDOWN_DURATION_MS): void {
    GeminiProvider.cooldowns.set(modelName, Date.now() + durationMs);
    logger.warn(
      `Gemini Model [${modelName}] marked in cooldown for ${Math.round(durationMs / 1000)}s due to quota or rate limit`
    );
  }

  public static clearCooldowns(): void {
    GeminiProvider.cooldowns.clear();
  }

  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs = 25000,
    errorMsg = 'Gemini request timed out'
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
    this.primaryModel = config.gemini.model;
    this.fallbackModel = config.gemini.fallbackModel;

    if (!config.gemini.isMockMode && config.gemini.apiKey) {
      this.genAI = new GoogleGenerativeAI(config.gemini.apiKey);
    }
  }

  private getSystemInstruction(memories?: string[]): string {
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
Identity: Always introduce and refer to yourself as Craft. Never say you are Gemini or Google.

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
- You possess full visual, auditory, and document perception. You can truly "see" images, "listen" to voice recordings/audio messages, and inspect documents and code.
- When a user sends a voice note (audio message), listen carefully to what they say in Egyptian Arabic or English, understand their intent deeply, execute any requested tools (reminders, weather, web search, memory), and reply warmly, helpfully, and concisely.
- When a user sends an image, inspect every visual aspect in depth and explain what is in the image naturally, warmly, and accurately.
- You can inspect, read, analyze, and debug any code and documents sent to you (PDF, Word .docx, Dart .dart, Markdown .md, JSON, YAML, etc.). Provide clear, structured, and helpful answers or code solutions.

Tools & Web Search:
- You have access to tools for current time, weather, web search, creating reminders, listing reminders, completing reminders, and saving memory facts.
- Live Web Search (web_search):
  * Proactively invoke 'web_search' whenever the user asks about:
    - Culture, riddles, guessing games, movies, series, songs, books, or historical facts from any country.
    - New or upcoming devices, foldable phones, leaks, rumors, or specs (e.g. iPhone Duo, iPhone Fold, iPhone 18, new chips).
    - Current market prices, local costs, or currency exchange rates in any country (e.g. أسعار الذهب، العملات، أسعار الموبايلات).
    - Recent news, breaking events, matches, or when the user asks you to search.
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

  public async generateReply(
    contents: Content[],
    useTools = true,
    memories?: string[]
  ): Promise<GeminiMessageResponse> {
    if (config.gemini.isMockMode || !this.genAI) {
      const mockRes = this.generateMockResponse(contents, memories);
      if (!mockRes.modelUsed) mockRes.modelUsed = this.primaryModel;
      if (!mockRes.usage) {
        mockRes.usage = { promptTokens: 30, completionTokens: 40, totalTokens: 70 };
      }
      return mockRes;
    }

    const hasMedia = contents.some((c) => c.parts?.some((p) => 'inlineData' in p));
    const timeoutMs = hasMedia ? 35000 : 25000;

    const candidateModels = [
      this.primaryModel || 'gemini-3.6-flash',
      this.fallbackModel || 'gemini-3.1-flash-lite',
      'gemini-3.6-flash',
      'gemini-3.1-flash-lite',
      'gemini-3.5-flash-lite',
      'gemini-flash-lite-latest',
      'gemini-flash-latest',
    ].filter((m, idx, arr) => m && arr.indexOf(m) === idx);

    for (let i = 0; i < candidateModels.length; i++) {
      const model = candidateModels[i];
      if (GeminiProvider.isModelInCooldown(model)) {
        logger.debug(`Skipping Gemini model [${model}] — currently in cooldown`);
        continue;
      }

      try {
        return await this.withTimeout(
          this.callModel(model, contents, useTools, memories),
          timeoutMs,
          `Gemini model [${model}] timed out after ${timeoutMs / 1000}s`
        );
      } catch (err: any) {
        const isQuotaOrUnavailable =
          err.message?.includes('429') ||
          err.message?.includes('Quota') ||
          err.message?.includes('quota') ||
          err.message?.includes('503');
        if (isQuotaOrUnavailable) {
          GeminiProvider.setModelCooldown(model);
        }
        logger.warn(
          `Gemini model [${model}] failed (${err.message}), trying next candidate...`
        );
      }
    }

    throw new Error('All candidate Gemini models are currently unavailable or in cooldown');
  }

  private async callModel(
    modelName: string,
    contents: Content[],
    useTools: boolean,
    memories?: string[]
  ): Promise<GeminiMessageResponse> {
    if (!this.genAI) throw new Error('Gemini SDK not initialized');

    const toolsConfig = useTools
      ? [{ functionDeclarations: this.toolRegistry.getGeminiFunctionDeclarations() }]
      : undefined;

    const model = this.genAI.getGenerativeModel({
      model: modelName,
      systemInstruction: this.getSystemInstruction(memories),
      tools: toolsConfig as any,
    });

    const result = await model.generateContent({
      contents,
      generationConfig: {
        maxOutputTokens: 1024,
        temperature: 0.7,
      },
    });
    const response = result.response;

    const usageMetadata = (response as any).usageMetadata;
    const usage = usageMetadata
      ? {
          promptTokens: usageMetadata.promptTokenCount || 0,
          completionTokens: usageMetadata.candidatesTokenCount || 0,
          totalTokens: usageMetadata.totalTokenCount || 0,
        }
      : undefined;

    const functionCalls = response.functionCalls();
    if (functionCalls && functionCalls.length > 0) {
      return {
        text: response.text() || '',
        functionCalls: functionCalls.map((fc) => ({
          name: fc.name,
          args: fc.args as Record<string, any>,
        })),
        modelUsed: modelName,
        usage,
      };
    }

    return {
      text: response.text() || '',
      modelUsed: modelName,
      usage,
    };
  }

  /**
   * Deterministic mock engine for local testing and CI when no API key is supplied or GEMINI_MOCK_MODE=true
   */
  private generateMockResponse(contents: Content[], memories?: string[]): GeminiMessageResponse {
    const lastContent = contents[contents.length - 1];
    const textPart = lastContent?.parts?.find((p) => 'text' in p);
    const lastText =
      textPart && 'text' in textPart && typeof textPart.text === 'string'
        ? textPart.text
        : '';
    const hasInlineData = lastContent?.parts?.some((p) => 'inlineData' in p);

    const allUserTexts = contents
      .filter((c) => c.role === 'user')
      .map((c) => c.parts.map((p) => ('text' in p ? p.text : '')).join(' '))
      .join(' ');

    // Multimodal & document responses in mock mode
    if (hasInlineData) {
      const inlinePart: any = lastContent.parts.find((p) => 'inlineData' in p);
      const mime = inlinePart?.inlineData?.mimeType || '';
      if (mime.startsWith('image/')) {
        return {
          text: 'لقد اطلعت على الصورة المرفقة بعناية! إنها واضحة ومميزة، وأستطيع رؤية تفاصيلها بالكامل. كيف تحب أن أساعدك فيها؟',
        };
      }
      if (mime.startsWith('audio/')) {
        return {
          text: 'سمعت تسجيلك الصوتي وفهمت طلبك بالكامل يا هندسة! جاهز لمساعدتك وتنفيذ ما طلبته فوراً.',
        };
      }
      if (mime === 'application/pdf') {
        return {
          text: 'لقد اطلعت على مستند الـ PDF المرفق وقرأت تفاصيله بنجاح. أنا جاهز لتلخيصه أو الإجابة عن أي سؤال يخصه.',
        };
      }
    }

    if (allUserTexts.includes('[ملف Word مرفق:')) {
      return {
        text: 'لقد قرأت ملف الـ Word المرفق واطلعت على محتواه النصي بالكامل بنجاح. جاهز لمساعدتك فيه ومناقشة تفاصيله!',
      };
    }

    if (allUserTexts.includes('[ملف برمجي/نصي مرفق:') || allUserTexts.includes('.dart')) {
      return {
        text: 'لقد فحصت الكود البرمجي المرفق بعناية. الكود منظم وجاهز لمساعدتك في شرحه أو تعديله أو حل المشاكل فيه يا هندسة!',
      };
    }

    // Check if this is a smart reminder trigger
    if (allUserTexts.includes('[نظام التذكيرات الذكية]')) {
      const reminderMatch = allUserTexts.match(/عنوان التذكير: "([^"]+)"/);
      const reminderTopic = reminderMatch ? reminderMatch[1] : 'التذكير المحدد';

      if (lastText.startsWith('Tool [') && lastText.includes('] result:')) {
        if (lastText.includes('get_weather')) {
          return {
            text: `⏰ *تذكير من كرافت*:\n\n📌 *بخصوص حالة الطقس في القاهرة*:\nدرجة الحرارة حالياً 28°C والجو مشمس ومعتدل في القاهرة اليوم. يومك سعيد وموفق يا هندسة!`,
          };
        }
        return {
          text: `⏰ *تذكير من كرافت*:\n\n📌 حان موعد: "${reminderTopic}".\nأرجو أن تكون في أتم صحة وعافية!`,
        };
      }

      if (reminderTopic.includes('طقس') || reminderTopic.includes('الجو') || reminderTopic.includes('weather')) {
        return {
          text: '',
          functionCalls: [{ name: 'get_weather', args: { city: 'Cairo' } }],
        };
      }

      return {
        text: `⏰ *تذكير من كرافت*:\n\n📌 حان الآن موعد: "${reminderTopic}".\nأرجو أن تكون في أتم صحة وعافية، وبالتوفيق دائماً!`,
      };
    }

    // If the latest message is a general tool observation, summarize the result and finish ReAct turn
    if (lastText.startsWith('Tool [') && lastText.includes('] result:')) {
      return {
        text: `بناءً على الأداة المستخدمة، النتيجة هي: ${lastText.substring(lastText.indexOf('result:') + 7)}`,
      };
    }

    const lower = lastText.toLowerCase();
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
        functionCalls: [{ name: 'get_current_time', args: {} }],
      };
    }

    if (lower.includes('weather') || lower.includes('طقس') || lower.includes('جو')) {
      return {
        text: '',
        functionCalls: [{ name: 'get_weather', args: { city: 'Cairo' } }],
      };
    }

    if (lower.includes('search') || lower.includes('بحث') || lower.includes('اخبار')) {
      return {
        text: '',
        functionCalls: [{ name: 'web_search', args: { query: 'Craft AI updates' } }],
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
        functionCalls: [{ name: 'list_reminders', args: {} }],
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
        functionCalls: [{ name: 'complete_reminder', args: { title: 'اجتماع' } }],
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
          { name: 'create_reminder', args: { title: 'Craft Agent Review', time: 'tomorrow' } },
        ],
      };
    }

    // Default conversational reply
    return {
      text: 'أهلاً بك! أنا Craft، وكيلك الذكي الشخصي. كيف يمكنني مساعدتك اليوم؟',
    };
  }
}
