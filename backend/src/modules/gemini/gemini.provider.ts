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
  private primaryModel: string;
  private fallbackModel: string;
  private apiKeys: string[];
  private clients: Map<string, GoogleGenerativeAI> = new Map();

  private static modelCooldowns: Map<string, number> = new Map();
  private static keyCooldowns: Map<string, number> = new Map();
  private static currentKeyIndex = 0;
  private static readonly COOLDOWN_DURATION_MS = 30 * 1000; // 30 seconds

  public static isModelInCooldown(modelName: string): boolean {
    const expiry = GeminiProvider.modelCooldowns.get(modelName);
    if (!expiry) return false;
    if (Date.now() > expiry) {
      GeminiProvider.modelCooldowns.delete(modelName);
      return false;
    }
    return true;
  }

  public static setModelCooldown(modelName: string, durationMs = GeminiProvider.COOLDOWN_DURATION_MS): void {
    GeminiProvider.modelCooldowns.set(modelName, Date.now() + durationMs);
    logger.warn(
      `Gemini Model [${modelName}] marked in cooldown for ${Math.round(durationMs / 1000)}s due to quota or rate limit`
    );
  }

  public static isKeyInCooldown(apiKey: string): boolean {
    const expiry = GeminiProvider.keyCooldowns.get(apiKey);
    if (!expiry) return false;
    if (Date.now() > expiry) {
      GeminiProvider.keyCooldowns.delete(apiKey);
      return false;
    }
    return true;
  }

  public static setKeyCooldown(apiKey: string, durationMs = 30000): void {
    GeminiProvider.keyCooldowns.set(apiKey, Date.now() + durationMs);
    const masked = apiKey ? apiKey.slice(0, 10) + '...' + apiKey.slice(-4) : 'unknown';
    logger.warn(`Gemini API Key [${masked}] marked in cooldown for ${Math.round(durationMs / 1000)}s`);
  }

  public static clearCooldowns(): void {
    GeminiProvider.modelCooldowns.clear();
    GeminiProvider.keyCooldowns.clear();
  }

  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs = 45000,
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

    this.apiKeys =
      config.gemini.apiKeys && config.gemini.apiKeys.length > 0
        ? config.gemini.apiKeys
        : [config.gemini.apiKey].filter(Boolean);
  }

  private getClient(apiKey: string): GoogleGenerativeAI {
    let client = this.clients.get(apiKey);
    if (!client) {
      client = new GoogleGenerativeAI(apiKey);
      this.clients.set(apiKey, client);
    }
    return client;
  }

  private getNextHealthyApiKey(): string {
    if (this.apiKeys.length === 0) return config.gemini.apiKey || '';
    for (let i = 0; i < this.apiKeys.length; i++) {
      const idx = (GeminiProvider.currentKeyIndex + i) % this.apiKeys.length;
      const key = this.apiKeys[idx];
      if (!GeminiProvider.isKeyInCooldown(key)) {
        GeminiProvider.currentKeyIndex = (idx + 1) % this.apiKeys.length;
        return key;
      }
    }
    // If all keys in cooldown, return the one expiring soonest
    let soonestKey = this.apiKeys[0];
    let minExpiry = Infinity;
    for (const key of this.apiKeys) {
      const exp = GeminiProvider.keyCooldowns.get(key) || 0;
      if (exp < minExpiry) {
        minExpiry = exp;
        soonestKey = key;
      }
    }
    return soonestKey;
  }

  private async executeWithKeyPool<T>(
    operation: (client: GoogleGenerativeAI, key: string) => Promise<T>
  ): Promise<T> {
    const candidateKeys = [...this.apiKeys];
    let lastError: any = null;

    for (let attempt = 0; attempt < candidateKeys.length; attempt++) {
      const key = this.getNextHealthyApiKey();
      if (!key) break;
      const client = this.getClient(key);

      try {
        return await operation(client, key);
      } catch (err: any) {
        lastError = err;
        const isModelOverloaded =
          err.message?.includes('503') ||
          err.message?.includes('high demand') ||
          err.message?.includes('Service Unavailable') ||
          err.message?.includes('UNAVAILABLE');

        if (isModelOverloaded) {
          // 503 is a model capacity issue on Google's servers, not an API key quota exhaustion.
          // Do not put the API key on cooldown! Re-throw so the caller can immediately try another model candidate.
          throw err;
        }

        const isQuotaOrRateLimit =
          err.message?.includes('429') ||
          err.message?.includes('Quota') ||
          err.message?.includes('quota') ||
          err.message?.includes('RESOURCE_EXHAUSTED');

        if (isQuotaOrRateLimit) {
          let cooldownMs = 30000;
          const retryMatch =
            err.message?.match(/Please retry in ([^\.]+?\.\d+s|\d+[hms]+|\d+\.\d+ms|\d+ms)/i) ||
            err.message?.match(/retryDelay["']?\s*:\s*["']?(\d+)s/i);
          if (retryMatch) {
            const timeStr = retryMatch[1];
            if (timeStr.endsWith('ms')) {
              cooldownMs = Math.max(2000, parseFloat(timeStr) + 500);
            } else if (timeStr.endsWith('s')) {
              cooldownMs = Math.max(2000, parseFloat(timeStr) * 1000 + 500);
            }
          }
          GeminiProvider.setKeyCooldown(key, cooldownMs);
          const masked = key.slice(0, 10) + '...' + key.slice(-4);
          logger.warn(`Gemini Key [${masked}] hit quota/rate limit, rotating immediately to next key in pool...`);
          continue;
        }
        throw err;
      }
    }
    throw lastError || new Error('All Gemini API keys in pool failed or are in cooldown');
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

    let instruction = `You are Craft, the personal AI assistant for the Craft ecosystem (Flutter & WhatsApp).
Cairo Local Time: ${cairoNow} (Date: ${today}).
Identity: Always introduce and refer to yourself as Craft. Never say you are Gemini or Google.
Tone & Dialect: Warm, professional, and concise Egyptian Arabic. Be friendly but avoid excessive colloquial fillers like "يا باشا" or "يا هندسة" on every message. Adapt to user dialect (Gulf, Levantine, MSA, English). Be direct and helpful.

### Reminders & Tasks (CRITICAL RULES):
- ALWAYS call 'create_reminder' when the user asks to be reminded of ANYTHING — even casually worded requests like: "فكرني", "ذكرني", "اعمل لي تذكير", "ابعتلي رسالة بعد X", "remind me", "set a reminder", "alert me".
- Extract the title from what they want to be reminded about, and the time from their message (e.g. "بعد دقيقة", "الساعة 10", "بكرة", "tomorrow 3pm").
- Set 'time' as a relative string (e.g. "بعد دقيقة") or ISO 8601 with Cairo offset +03:00. Support recurring reminders via 'recurrence': 'daily', 'weekly', 'monthly'.
- ALWAYS call 'list_reminders' when the user asks about their tasks, to-dos, or reminder list.
- NEVER answer reminder requests conversationally without calling the tool first.

Knowledge & Web Search Rules:
- STRICT PROHIBITION: NEVER fabricate or guess movie/series titles, actors, songs, riddles, or historical facts. You MUST invoke 'web_search'.
- Prices & Specs: Whenever asked about prices (in Egypt, Arab markets, or globally/USD), tech specs, upcoming/rumored gadgets (e.g. iPhone Duo, iPhone 18, Foldables), exchange rates, or gold: ALWAYS invoke 'web_search'.
- Follow-up Context: When the user asks a follow-up (e.g. "سعرو كام بره مصر", "مواصفاته ايه"), synthesize the full query using previous conversation context and call 'web_search'!
- Egypt Currency Reality: The official bank exchange rate in Egypt is approximately ~48 to 50+ EGP per USD. NEVER state or calculate with obsolete rates like 30 or 31 EGP!
- Anti-leak & Professionalism: NEVER mention internal technical terms like "RSS", "محرك البحث", "الـ API", "نتائج البحث لم تذكر". Speak naturally and authoritatively as Craft with concrete numbers, storage variants, and distributor quotes (e.g. Tradeline/تريدلاين، بي تك، موبايل مصر).
- Other Tools: web_search, complete_reminder, save_memory.
- Multimodal: You perceive images, audio voice notes, documents (PDF/Word), and code.

WhatsApp & Mobile Formatting Rules:
- STRICT PROHIBITION: NEVER use Markdown tables (| col |). WhatsApp renders them poorly.
- Use clean bullet points (•) and *bold* for headings and key terms.
- NEVER output raw HTML (<br>, <div>). Use standard clean line breaks.`;

    if (memories && memories.length > 0) {
      instruction += `\n\n### Stored User Profile:\n${memories.map((m) => `- ${m}`).join('\n')}`;
    }

    return instruction;
  }

  public async generateReply(
    contents: Content[],
    useTools = true,
    memories?: string[]
  ): Promise<GeminiMessageResponse> {
    if (config.gemini.isMockMode || (this.apiKeys.length === 0 && !config.gemini.apiKey)) {
      const mockRes = this.generateMockResponse(contents, memories);
      if (!mockRes.modelUsed) mockRes.modelUsed = this.primaryModel;
      if (!mockRes.usage) {
        mockRes.usage = { promptTokens: 30, completionTokens: 40, totalTokens: 70 };
      }
      return mockRes;
    }

    const hasMedia = contents.some((c) => c.parts?.some((p) => 'inlineData' in p));
    const timeoutMs = hasMedia ? 25000 : 4500;

    const candidateModels = [
      this.primaryModel,
      'gemini-3.5-flash',
      'gemini-3.6-flash',
      'gemini-3.8-flash',
      this.fallbackModel,
      'gemini-3.5-flash-lite',
    ].filter((m, idx, arr) => m && arr.indexOf(m) === idx) as string[];

    let modelAttempts = 0;
    for (let i = 0; i < candidateModels.length; i++) {
      const model = candidateModels[i];
      if (GeminiProvider.isModelInCooldown(model)) {
        logger.debug(`Skipping Gemini model [${model}] — currently in cooldown`);
        continue;
      }

      modelAttempts++;
      if (modelAttempts > 2) {
        logger.warn('Maximum Gemini model attempts reached (2), falling back immediately to Groq');
        break;
      }

      try {
        return await this.executeWithKeyPool(async (client, activeKey) => {
          return await this.withTimeout(
            this.callModel(client, model, contents, useTools, memories),
            timeoutMs,
            `Gemini model [${model}] timed out after ${timeoutMs / 1000}s`
          );
        });
      } catch (err: any) {
        logger.warn(
          `Gemini model [${model}] failed on available keys (${err.message}), trying next model candidate...`
        );
        GeminiProvider.setModelCooldown(model, 30000);
      }
    }

    throw new Error('All candidate Gemini models and API keys are currently unavailable or in cooldown');
  }

  private async callModel(
    client: GoogleGenerativeAI,
    modelName: string,
    contents: Content[],
    useTools: boolean,
    memories?: string[]
  ): Promise<GeminiMessageResponse> {
    const toolsConfig = useTools
      ? [{ functionDeclarations: this.toolRegistry.getGeminiFunctionDeclarations() }]
      : undefined;

    const model = client.getGenerativeModel({
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
