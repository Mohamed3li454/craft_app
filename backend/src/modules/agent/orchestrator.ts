/**
 * Agent Orchestrator (Phase 8.1 - Pipeline Refactored)
 *
 * Provides the public facade for Craft AI Agent execution, delegating
 * the multi-stage lifecycle to the composable AgentPipeline while maintaining
 * 100% backward compatibility for existing callers and test suites.
 */

import { GroqProvider, GroqMessage } from '../groq/groq.provider';
import { ToolRegistry } from '../tools/registry';
import { ConfirmationService } from '../confirmation/confirmation.service';
import { ChatRepository } from '../../database/repositories/chat.repo';
import { MemoryRepository } from '../../database/repositories/memory.repo';
import { UserRepository } from '../../database/repositories/user.repo';
import { UserPreferenceRepository } from '../../database/repositories/user_preference.repo';
import { config } from '../../config/env';
import { logger } from '../../core/logger';
import {
  MemoryRetrievalService,
  MemoryContextAssembler,
} from '../memory';
import {
  LanguageIntelligenceService,
  LanguageContext,
} from '../language';
import {
  PersonalityEngine,
  PersonalityContext,
} from '../personality';
import {
  AgentPipeline,
  AgentRunInput,
  AgentRunOutput,
  AgentMediaAttachment,
  processMediaAttachment,
  formatGroqConversationHistory,
  serializeToolResultForGroq,
} from './pipeline';

// Re-export public types and helpers for existing consumers
export {
  AgentMediaAttachment,
  AgentRunInput,
  AgentRunOutput,
  processMediaAttachment,
  formatGroqConversationHistory,
  serializeToolResultForGroq,
};

export class AgentOrchestrator {
  private pipeline: AgentPipeline;

  constructor(
    private groqProvider: GroqProvider = new GroqProvider(),
    private toolRegistry: ToolRegistry = ToolRegistry.getInstance(),
    private confirmationService: ConfirmationService = new ConfirmationService(),
    private chatRepo: ChatRepository = new ChatRepository(),
    private memoryRepo: MemoryRepository = new MemoryRepository(),
    private userRepo: UserRepository = new UserRepository(),
    private userPreferenceRepo: UserPreferenceRepository = new UserPreferenceRepository(),
    pipeline?: AgentPipeline
  ) {
    this.groqProvider = groqProvider ?? new GroqProvider();
    this.toolRegistry = toolRegistry ?? ToolRegistry.getInstance();
    this.confirmationService = confirmationService ?? new ConfirmationService();
    this.chatRepo = chatRepo ?? new ChatRepository();
    this.memoryRepo = memoryRepo ?? new MemoryRepository();
    this.userRepo = userRepo ?? new UserRepository();
    this.userPreferenceRepo = userPreferenceRepo ?? new UserPreferenceRepository();

    this.pipeline =
      pipeline ??
      new AgentPipeline({
        groqProvider: this.groqProvider,
        toolRegistry: this.toolRegistry,
        confirmationService: this.confirmationService,
        chatRepo: this.chatRepo,
        memoryRepo: this.memoryRepo,
        userRepo: this.userRepo,
        userPreferenceRepo: this.userPreferenceRepo,
      });
  }

  /**
   * Main agent entry point: delegates execution to the modular AgentPipeline.
   */
  public async run(input: AgentRunInput): Promise<AgentRunOutput> {
    return this.pipeline.execute(input);
  }

  /**
   * Access to underlying pipeline for testing and inspection.
   */
  public getPipeline(): AgentPipeline {
    return this.pipeline;
  }

  /**
   * Intelligently dispatches a due reminder by letting the LLM inspect the reminder intent,
   * call appropriate live tools (e.g. get_weather, web_search), and formulate a complete, rich notification.
   */
  public async generateSmartReminder(
    userId: string,
    reminderTitle: string,
    languageContext?: LanguageContext,
    personalityContext?: PersonalityContext
  ): Promise<string> {
    try {
      const langCtx = languageContext || LanguageIntelligenceService.getInstance().resolveContext(reminderTitle);
      const persCtx = personalityContext || PersonalityEngine.getInstance().getDefaultPersonality();
      const isEnglish = langCtx.targetLanguage === 'en';

      // Phase 4.6: Selective memory retrieval for smart reminder
      const retrievalService = MemoryRetrievalService.getInstance(this.memoryRepo);
      const retrieved = await retrievalService.retrieve({
        userId,
        message: reminderTitle,
        language: langCtx.targetLanguage,
      });
      const memoryContext = MemoryContextAssembler.getInstance().assemble(retrieved, {
        language: langCtx.targetLanguage,
      });
      const memories =
        memoryContext.selectedCount > 0
          ? memoryContext.memories.map((m) => m.memory.factText)
          : undefined;
      const prompt = isEnglish
        ? `[Smart Reminder System]
It is now time for the user's scheduled reminder. Reminder title: "${reminderTitle}".
Task for Craft AI assistant:
1. Verify carefully: Does this reminder require fetching live or current information for the user?
   - If about weather: call 'get_weather' immediately to get live weather conditions!
   - If about news: call 'web_search' immediately to get current live news!
   - If about any other live info: call the appropriate tool.
2. After fetching the info (or if it's a standard personal reminder like medication or meeting):
   Formulate the reminder message in clear, well-formatted English, starting with:
   ⏰ *Reminder from Craft*:
   Followed by well-formatted details directly.`
        : `[نظام التذكيرات الذكية]
حان الآن موعد تذكير للمستخدم. عنوان التذكير: "${reminderTitle}".
المطلوب منك كوكيل ذكي:
1. تحقق بدقة: هل يتطلب هذا التذكير جلب معلومات حية أو حالية للمستخدم؟
   - إذا كان عن الطقس (مثل: طقس القاهرة، أحوال الجو): استدعِ أداة get_weather فوراً لجلب حالة الطقس الفعلية الحالية!
   - إذا كان عن أخبار (مثل: أهم أخبار نيويورك، أخبار تقنية): استدعِ أداة web_search فوراً لجلب الأخبار الحية الحالية!
   - إذا كان عن أي معلومة أخرى: استدعِ الأداة المناسبة.
2. بعد جلب المعلومات (أو إذا كان التذكير تنبيهاً شخصياً عادياً مثل موعد دواء أو صلاة أو اجتماع):
   صِغ رسالة التذكير بأسلوب واضح ومباشر${langCtx.dialect === 'egyptian' ? ' باللهجة المصرية المهنية' : ''}، تبدأ بـ:
   ⏰ *تذكير من كرافت*:
   ثم تفاصيل التذكير والمعلومات المطلوبة بدقة وتنسيق مرتب.`;

      const conv = await this.chatRepo.getOrCreateConversation(userId, 'whatsapp');

      // Smart reminder execution exclusively via Groq
      const groqMessages: GroqMessage[] = [{ role: 'user', content: prompt }];
      let iterations = 0;
      while (iterations < config.security.maxIterations) {
        iterations++;
        const reply = await this.groqProvider.generateReply(groqMessages, true, memories, undefined, langCtx, persCtx);

        if (reply.functionCalls && reply.functionCalls.length > 0) {
          const fc = reply.functionCalls[0];
          const tool = this.toolRegistry.getTool(fc.name);
          if (tool) {
            const toolResult = await this.toolRegistry.executeTool(tool.name, fc.args, {
              userId,
              conversationId: conv.id,
              channel: 'whatsapp',
              languageContext: langCtx,
            });
            const directSynth: GroqMessage[] = [
              { role: 'user', content: prompt },
              {
                role: 'user',
                content: `[${isEnglish ? `Result of tool ${tool.name}` : `نتيجة أداة ${tool.name}`}]:\n${serializeToolResultForGroq(
                  tool.name,
                  toolResult.output || toolResult.error,
                  langCtx
                )}\n\n${isEnglish ? 'Formulate the final reminder message now in clear English.' : 'صِغ رسالة التذكير النهائية الآن بأسلوب واضح ومباشر.'}`,
              },
            ];
            const synthRes = await this.groqProvider.generateReply(directSynth, false, memories, undefined, langCtx, persCtx);
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

    const isEnglish = (languageContext?.targetLanguage || 'ar') === 'en';
    return isEnglish
      ? `⏰ *Reminder from Craft*:\n\n📌 *Topic*: "${reminderTitle}"\n\nIt is now time for this scheduled reminder.`
      : `⏰ *تذكير من كرافت*:\n\n📌 *الموضوع*: "${reminderTitle}"\n\nحان الآن موعد هذا التذكير المحدد.`;
  }
}
