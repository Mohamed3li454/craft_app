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
  private apiKeys: string[];

  private static keyCooldowns: Map<string, number> = new Map();
  private static currentKeyIndex = 0;
  private static modelCooldowns: Map<string, number> = new Map();
  private static readonly COOLDOWN_DURATION_MS = 15 * 1000; // 15 seconds

  public static isModelInCooldown(modelName: string): boolean {
    const expiry = GroqProvider.modelCooldowns.get(modelName);
    if (!expiry) return false;
    if (Date.now() > expiry) {
      GroqProvider.modelCooldowns.delete(modelName);
      return false;
    }
    return true;
  }

  public static setModelCooldown(modelName: string, durationMs = GroqProvider.COOLDOWN_DURATION_MS): void {
    GroqProvider.modelCooldowns.set(modelName, Date.now() + durationMs);
    logger.warn(
      `Groq Model [${modelName}] marked in cooldown for ${Math.round(durationMs / 1000)}s due to quota or rate limit`
    );
  }

  public static isKeyInCooldown(apiKey: string): boolean {
    const expiry = GroqProvider.keyCooldowns.get(apiKey);
    if (!expiry) return false;
    if (Date.now() > expiry) {
      GroqProvider.keyCooldowns.delete(apiKey);
      return false;
    }
    return true;
  }

  public static setKeyCooldown(apiKey: string, durationMs = 15000): void {
    GroqProvider.keyCooldowns.set(apiKey, Date.now() + durationMs);
    const masked = apiKey ? apiKey.slice(0, 8) + '...' + apiKey.slice(-4) : 'unknown';
    logger.warn(`Groq API Key [${masked}] marked in cooldown for ${Math.round(durationMs / 1000)}s`);
  }

  public static clearCooldowns(): void {
    GroqProvider.modelCooldowns.clear();
    GroqProvider.keyCooldowns.clear();
  }

  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs = 35000,
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
    this.apiKeys = config.groq.apiKeys && config.groq.apiKeys.length > 0
      ? config.groq.apiKeys
      : [config.groq.apiKey].filter(Boolean);
  }

  private getNextHealthyApiKey(): string {
    if (this.apiKeys.length === 0) return this.apiKey || '';
    for (let i = 0; i < this.apiKeys.length; i++) {
      const idx = (GroqProvider.currentKeyIndex + i) % this.apiKeys.length;
      const key = this.apiKeys[idx];
      if (!GroqProvider.isKeyInCooldown(key)) {
        GroqProvider.currentKeyIndex = (idx + 1) % this.apiKeys.length;
        return key;
      }
    }
    // If all keys in cooldown, return the one expiring soonest
    let soonestKey = this.apiKeys[0];
    let minExpiry = Infinity;
    for (const key of this.apiKeys) {
      const exp = GroqProvider.keyCooldowns.get(key) || 0;
      if (exp < minExpiry) {
        minExpiry = exp;
        soonestKey = key;
      }
    }
    return soonestKey;
  }

  private async executeWithKeyPool<T>(
    operation: (key: string) => Promise<T>
  ): Promise<T> {
    const candidateKeys = [...this.apiKeys];
    let lastError: any = null;

    for (let attempt = 0; attempt < candidateKeys.length; attempt++) {
      const key = this.getNextHealthyApiKey();
      if (!key) break;

      try {
        return await operation(key);
      } catch (err: any) {
        lastError = err;
        const isRateLimit =
          err.message?.includes('429') ||
          err.message?.includes('rate_limit_exceeded') ||
          err.message?.includes('tokens per minute');
        if (isRateLimit) {
          let cooldownMs = 15000;
          const retryMatch = err.message?.match(/try again in (\d+(\.\d+)?)s/i);
          if (retryMatch) {
            cooldownMs = Math.ceil(parseFloat(retryMatch[1]) * 1000) + 1000;
          }
          GroqProvider.setKeyCooldown(key, cooldownMs);
          const masked = key.slice(0, 8) + '...' + key.slice(-4);
          logger.warn(`Groq Key [${masked}] rate limited, rotating immediately to next key in pool...`);
          continue;
        }
        throw err;
      }
    }
    throw lastError || new Error('All Groq API keys in pool failed or are in cooldown');
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

    let instruction = `You are Craft, the personal AI assistant for the Craft ecosystem.
User Timezone: Africa/Cairo (Egypt, UTC+3). Local Time: ${cairoNow} (Date: ${today}).
Identity: Always introduce and refer to yourself as Craft. Never say you are ChatGPT, OpenAI, Groq, or Google.
Tone & Dialect: Warm, professional, and concise Egyptian Arabic. Be friendly but avoid excessive colloquial fillers like "يا باشا" or "يا هندسة" on every message. Be direct and helpful.

### Reminders & Tasks (CRITICAL RULES):
- ALWAYS call 'create_reminder' when the user asks to be reminded of ANYTHING — even casually worded requests like: "فكرني", "ذكرني", "اعمل لي تذكير", "ابعتلي رسالة بعد X", "remind me", "set a reminder", "alert me".
- Extract the title from what they want to be reminded about, and the time from their message (e.g. "بعد دقيقة", "الساعة 10", "بكرة", "tomorrow 3pm").
- ALWAYS call 'list_reminders' when the user asks about their tasks, to-dos, or reminder list.
- NEVER answer reminder requests conversationally without calling the tool first.

### Live Web Search & Knowledge Rules:
- STRICT REQUIREMENT: Whenever the user asks about ANY tech products (e.g. iPhone, Samsung, Xiaomi), device prices (in Egypt, Arab countries, or globally/USD), hardware specifications, leaks, future/upcoming devices (e.g. iPhone Duo, iPhone 18, Foldables, etc.), exchange rates, gold prices, movies, songs, or recent news:
  YOU MUST ALWAYS INVOKE THE 'web_search' TOOL! NEVER assume a device does not exist or answer from stale memory without searching!
- Follow-up Context: When the user asks a follow-up (e.g. "سعرو كام بره مصر", "مواصفاته ايه", "بكام بالدولار"), ALWAYS look at recent conversation turns to identify the referenced product, synthesize a complete and targeted search query (e.g. "iPhone Duo global price USD" or "سعر ايفون duo بالدولار عالميا"), and call 'web_search'!
- Egypt Currency Reality: The official bank exchange rate in Egypt is approximately ~48 to 50+ EGP per USD. NEVER state or calculate with obsolete rates like 30 or 31 EGP!
- Anti-leak & Professionalism: NEVER mention internal technical terms like "RSS", "محرك البحث", "الـ API", "نتائج البحث لم تذكر". Speak naturally and authoritatively as Craft with concrete numbers, storage variants, and distributor quotes (e.g. Tradeline/تريدلاين، بي تك، موبايل مصر).

Formatting Rules:
- STRICT PROHIBITION: NEVER use Markdown tables (| col |). WhatsApp renders tables poorly.
- Use clean bullet points (•) and *bold* for headings and key terms.
- NEVER output raw HTML (<br>, <div>). Use standard clean line breaks.`;

    if (memories && memories.length > 0) {
      instruction += `\n\n### Stored User Profile:\n${memories.map((m) => `- ${m}`).join('\n')}`;
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

      const data: any = await this.executeWithKeyPool(async (activeKey) => {
        const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${activeKey}`,
          },
          body: form,
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Groq Whisper Error (${response.status}): ${errorText}`);
        }
        return await response.json();
      });
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
      const visionModel = 'qwen/qwen3.8-27b';
      try {
        logger.info(`Image detected, routing directly to Groq Vision model [${visionModel}]`);
        return await this.withTimeout(
          this.callChat(visionModel, messages, useTools, memories, imageAttachment),
          35000,
          `Groq Vision model [${visionModel}] timed out after 35s`
        );
      } catch (err: any) {
        logger.error(`Groq Vision call with [${visionModel}] failed`, { error: err.message });
        throw err;
      }
    }

    // Text & tools cascade: Primary model (openai/gpt-oss-120b) with automatic fallbacks:
    // openai/gpt-oss-20b -> qwen/qwen3.8-27b
    const textModels = [
      this.primaryModel,
      this.fallbackModel,
      'qwen/qwen3.8-27b',
    ].filter((m, idx, arr) => arr.indexOf(m) === idx);

    for (let i = 0; i < textModels.length; i++) {
      const model = textModels[i];
      if (GroqProvider.isModelInCooldown(model)) {
        logger.debug(`Skipping Groq model [${model}] — currently in cooldown`);
        continue;
      }

      try {
        return await this.withTimeout(
          this.callChat(model, messages, useTools, memories),
          25000,
          `Groq model [${model}] timed out after 25s`
        );
      } catch (err: any) {
        const isQuotaOrRateLimit =
          err.message?.includes('429') ||
          err.message?.includes('rate_limit_exceeded');
        if (isQuotaOrRateLimit) {
          // Parse exact retry delay from Groq error (supports e.g. "4.92s", "17m53.52s", "1h20m")
          let cooldownMs = GroqProvider.COOLDOWN_DURATION_MS;
          let parsedMs = 0;
          const retryMatch =
            err.message?.match(/Please try again in ([^\.]+?\.\d+s|\d+[hms]+)/i) ||
            err.message?.match(/Please try again in ([^\\n\\.]+)/i);
          const timeStr = retryMatch ? retryMatch[1] : '';
          const hourMatch = timeStr.match(/(\d+(\.\d+)?)h/i);
          const minMatch = timeStr.match(/(\d+(\.\d+)?)m(?!s)/i);
          const secMatch = timeStr.match(/(\d+(\.\d+)?)s/i);

          if (hourMatch) parsedMs += parseFloat(hourMatch[1]) * 3600 * 1000;
          if (minMatch) parsedMs += parseFloat(minMatch[1]) * 60 * 1000;
          if (secMatch) parsedMs += parseFloat(secMatch[1]) * 1000;

          if (parsedMs > 0) {
            cooldownMs = Math.ceil(parsedMs) + 1000;
          }
          GroqProvider.setModelCooldown(model, cooldownMs);
        }
        logger.warn(
          `Groq model [${model}] failed (${err.message}), trying next fallback model...`
        );
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
      max_tokens: 2048,
      temperature: 0.7,
    };

    if (useTools) {
      payload.tools = this.toolRegistry.getOpenAITools();
      payload.tool_choice = 'auto';
    }

    const data: any = await this.executeWithKeyPool(async (activeKey) => {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${activeKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Groq API Error (${res.status}): ${errText}`);
      }

      return await res.json();
    });
    const choice = data.choices?.[0];
    const assistantMsg = choice?.message;

    if (!assistantMsg) {
      throw new Error('Groq API returned empty choices array');
    }

    // Detect empty output: model returned neither text nor tool_calls
    // This causes "model output must contain either output text or tool calls" downstream
    const hasText = assistantMsg.content && assistantMsg.content.trim().length > 0;
    const hasToolCalls = assistantMsg.tool_calls && assistantMsg.tool_calls.length > 0;
    if (!hasText && !hasToolCalls) {
      // Throw so the cascade can retry with the next model
      throw new Error(`Groq model [${modelName}] returned empty output (no text or tool calls) — retrying with next model`);
    }

    const usage = data.usage
      ? {
          promptTokens: data.usage.prompt_tokens || 0,
          completionTokens: data.usage.completion_tokens || 0,
          totalTokens: data.usage.total_tokens || 0,
        }
      : undefined;

    // Check for tool calls
    if (hasToolCalls) {
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
    if (config.groq.isMockMode) {
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
