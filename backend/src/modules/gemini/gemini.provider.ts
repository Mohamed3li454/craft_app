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
}

export class GeminiProvider {
  private genAI: GoogleGenerativeAI | null = null;
  private primaryModel: string;
  private fallbackModel: string;

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
Personality: Helpful, smart, polite, concise, and friendly. You support both Arabic and English seamlessly. When communicating in Arabic, adopt a warm, natural Egyptian dialect whenever the user prefers or speaks Egyptian.
Tools: You have access to tools for current time, weather, web search, creating reminders, listing reminders, completing reminders, and saving memory facts.
- Use tools whenever the user asks for reminders, time, weather, real-time info, or when the user shares permanent facts about themselves.
- When creating a reminder (create_reminder):
  * Calculate the target time accurately from the current Cairo time (${cairoNow}).
  * If the user says "بعد دقيقة" (in 1 minute), add 1 minute to ${cairoNow}.
  * Always provide the 'time' argument as an ISO 8601 string including the Cairo offset '+03:00' (e.g. YYYY-MM-DDTHH:mm:00+03:00).
- When the user asks to see or list their reminders/tasks, invoke 'list_reminders'.
- When the user marks a task or reminder as done/finished, invoke 'complete_reminder'.
- When the user shares personal details about themselves (such as job, profession, dialect preference, name, location, or hobbies), invoke 'save_memory' to persist it permanently.
- Always remember details mentioned in previous turns of the conversation and the stored long-term memory below. Reference them naturally and answer immediately when asked about them!`;

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
      return this.generateMockResponse(contents, memories);
    }

    try {
      return await this.callModel(this.primaryModel, contents, useTools, memories);
    } catch (err: any) {
      logger.warn(`Primary model [${this.primaryModel}] failed, attempting fallback to [${this.fallbackModel}]`, {
        error: err.message,
      });

      try {
        return await this.callModel(this.fallbackModel, contents, useTools, memories);
      } catch (fallbackErr: any) {
        logger.error(`Fallback model [${this.fallbackModel}] also failed`, {
          error: fallbackErr.message,
        });
        throw fallbackErr;
      }
    }
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

    const result = await model.generateContent({ contents });
    const response = result.response;

    const functionCalls = response.functionCalls();
    if (functionCalls && functionCalls.length > 0) {
      return {
        text: response.text() || '',
        functionCalls: functionCalls.map((fc) => ({
          name: fc.name,
          args: fc.args as Record<string, any>,
        })),
      };
    }

    return {
      text: response.text() || '',
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

    const allUserTexts = contents
      .filter((c) => c.role === 'user')
      .map((c) => c.parts.map((p) => ('text' in p ? p.text : '')).join(' '))
      .join(' ');

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
