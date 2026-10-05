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
   * Intelligently dispatches a due reminder by delegating execution to AgentPipeline
   * with triggerType: 'smart_reminder'. AgentPipeline coordinates CognitiveStage (memory
   * retrieval, language/personality resolution, token budgeting) and ExecutionEngine
   * (AIRouter, ToolLifecycleManager, LoopGuard, StepVerifier).
   */
  public async generateSmartReminder(
    userId: string,
    reminderTitle: string,
    languageContext?: LanguageContext,
    personalityContext?: PersonalityContext,
    reminderId?: string
  ): Promise<string> {
    const langCtx = languageContext || LanguageIntelligenceService.getInstance().resolveContext(reminderTitle);
    const persCtx = personalityContext || PersonalityEngine.getInstance().getDefaultPersonality();
    const isEnglish = langCtx.targetLanguage === 'en';

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

    try {
      const output = await this.pipeline.execute({
        userId,
        channel: 'whatsapp',
        text: prompt,
        triggerType: 'smart_reminder',
        reminderId,
        reminderTitle,
        explicitPersonalityPreference: personalityContext
          ? {
              tone: personalityContext.tone,
              formality: personalityContext.formality,
              verbosity: personalityContext.verbosity,
              addressingStyle: personalityContext.addressingStyle,
              emojiPolicy: personalityContext.emojiPolicy,
              humorLevel: personalityContext.humorLevel,
            }
          : undefined,
      });

      if (output?.replyText && output.replyText.trim()) {
        return output.replyText.trim();
      }
    } catch (err: any) {
      logger.warn('Failed to generate smart reminder content via AgentPipeline, falling back to default', {
        error: err.message,
      });
    }

    return isEnglish
      ? `⏰ *Reminder from Craft*:\n\n📌 *Topic*: "${reminderTitle}"\n\nIt is now time for this scheduled reminder.`
      : `⏰ *تذكير من كرافت*:\n\n📌 *الموضوع*: "${reminderTitle}"\n\nحان الآن موعد هذا التذكير المحدد.`;
  }
}
