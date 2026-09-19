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

  private getSystemInstruction(): string {
    const today = new Date().toISOString().split('T')[0];
    return `You are Craft, the personal AI assistant for the Craft ecosystem (available on Flutter mobile and WhatsApp).
Current Date: ${today}.
Identity: Always introduce and refer to yourself as Craft. Never say you are Gemini or Google.
Personality: Helpful, smart, polite, and concise. You support both Arabic and English seamlessly.
Tools: You have access to tools for current time, weather, web search, creating reminders, listing reminders, and completing reminders.
- Use tools whenever the user asks for reminders, time, weather, or real-time info.
- When creating a reminder, invoke 'create_reminder' (this will ask for user confirmation).
- When the user asks to see or list their reminders/tasks, invoke 'list_reminders'.
- When the user marks a task or reminder as done/finished, invoke 'complete_reminder'.
- Always remember details mentioned in previous turns of the conversation (such as user name, job, location, past preferences) and reference them naturally.`;
  }

  public async generateReply(
    contents: Content[],
    useTools = true
  ): Promise<GeminiMessageResponse> {
    if (config.gemini.isMockMode || !this.genAI) {
      return this.generateMockResponse(contents);
    }

    try {
      return await this.callModel(this.primaryModel, contents, useTools);
    } catch (err: any) {
      logger.warn(`Primary model [${this.primaryModel}] failed, attempting fallback to [${this.fallbackModel}]`, {
        error: err.message,
      });

      try {
        return await this.callModel(this.fallbackModel, contents, useTools);
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
    useTools: boolean
  ): Promise<GeminiMessageResponse> {
    if (!this.genAI) throw new Error('Gemini SDK not initialized');

    const toolsConfig = useTools
      ? [{ functionDeclarations: this.toolRegistry.getGeminiFunctionDeclarations() }]
      : undefined;

    const model = this.genAI.getGenerativeModel({
      model: modelName,
      systemInstruction: this.getSystemInstruction(),
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
  private generateMockResponse(contents: Content[]): GeminiMessageResponse {
    const lastContent = contents[contents.length - 1];
    const textPart = lastContent?.parts?.find((p) => 'text' in p);
    const lastText =
      textPart && 'text' in textPart && typeof textPart.text === 'string'
        ? textPart.text
        : '';

    // If the latest message is a tool observation, summarize the result and finish ReAct turn
    if (lastText.startsWith('Tool [') && lastText.includes('] result:')) {
      return {
        text: `بناءً على الأداة المستخدمة، النتيجة هي: ${lastText.substring(lastText.indexOf('result:') + 7)}`,
      };
    }

    const lower = lastText.toLowerCase();

    // Context / Memory checks across past turns
    const allUserTexts = contents
      .filter((c) => c.role === 'user')
      .map((c) => c.parts.map((p) => ('text' in p ? p.text : '')).join(' '))
      .join(' ');

    if (lower.includes('شغال ايه') || lower.includes('شغال إيه') || lower.includes('وفين')) {
      if (allUserTexts.includes('مبرمج') && allUserTexts.includes('القاهرة')) {
        return {
          text: 'أنت تعمل كمبرمج فلاتر في القاهرة وفقاً لما أخبرتني به سابقاً! كيف يمكنني مساعدتك في مشروعك اليوم؟',
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
