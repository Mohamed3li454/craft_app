/**
 * Preflight Stage (Phase 8.1)
 *
 * Handles pre-execution tasks:
 * - Preference resolution
 * - Semantic Cache verification (0 tokens, early exit)
 * - Daily Rate Limiting (early exit)
 * - Multimodal audio transcription (Groq Whisper)
 * - Media attachment preparation
 * - Interim progress notices
 * - Conversation resolution
 */

import { logger } from '../../../../core/logger';
import { LanguageIntelligenceService } from '../../../language';
import { PersonalityEngine } from '../../../personality';
import { SemanticCacheEngine } from '../../../cache/semantic_cache_engine';
import { ToolCapabilityPolicy, TriggerContract } from '../../../tools';
import { RuntimePolicyResolver } from '../../../../config/runtime_policy';
import { AgentPipelineContext, AgentPipelineDependencies, PipelineStage } from '../types';
import { processMediaAttachment } from '../helpers';

export class PreflightStage implements PipelineStage {
  public readonly name = 'preflight';

  public async execute(ctx: AgentPipelineContext, deps: AgentPipelineDependencies): Promise<void> {
    const isSystemTrigger = TriggerContract.isSystemTrigger(ctx.triggerType);

    // 1. Language & Personality Context resolution (from stored preferences)
    const [storedLangPref, storedPersPref] = await Promise.all([
      deps.userPreferenceRepo.getLanguagePreference(ctx.input.userId).catch(() => null),
      deps.userPreferenceRepo.getPersonalityPreference(ctx.input.userId).catch(() => null),
    ]);

    ctx.languageContext = LanguageIntelligenceService.getInstance().resolveContext(ctx.cleanUserText, {
      storedPreference: storedLangPref
        ? { language: storedLangPref.language, dialect: storedLangPref.dialect }
        : undefined,
    });

    ctx.personalityContext = PersonalityEngine.getInstance().resolve({
      explicitPreference: ctx.input.explicitPersonalityPreference || (storedPersPref ?? undefined),
    });

    // 1.1 Maintenance Mode Check (user-facing conversational turns only)
    const policy = RuntimePolicyResolver.getPolicy();
    if (!isSystemTrigger && policy.maintenanceMode) {
      const isEnglish = ctx.languageContext?.language === 'en';
      const maintenanceMsg = isEnglish
        ? 'The system is currently undergoing scheduled maintenance. Please try again shortly.'
        : 'النظام في وضع الصيانة المجدولة حالياً. يرجى المحاولة مرة أخرى لاحقاً.';

      const conversation = await deps.chatRepo.getOrCreateConversation(ctx.input.userId, ctx.input.channel);
      const conversationId = conversation.id;

      await Promise.all([
        deps.chatRepo.saveMessage(
          conversationId,
          'user',
          ctx.input.channel === 'whatsapp' ? 'WhatsApp User' : 'User',
          ctx.cleanUserText || 'User Message'
        ),
        deps.chatRepo.saveMessage(
          conversationId,
          'assistant',
          'Craft',
          maintenanceMsg,
          undefined,
          {
            tokensUsed: 0,
            promptTokens: 0,
            completionTokens: 0,
            modelName: 'maintenance-gate',
            latencyMs: Date.now() - ctx.startTime,
          }
        ),
      ]);

      ctx.earlyExitOutput = {
        conversationId,
        agentRunId: ctx.agentRunId,
        status: 'completed',
        replyText: maintenanceMsg,
        toolCallsExecuted: [],
        metrics: {
          modelUsed: 'maintenance-gate',
          latencyMs: Date.now() - ctx.startTime,
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
        },
        languageContext: ctx.languageContext,
        personalityContext: ctx.personalityContext,
      };
      return;
    }

    // 2. Semantic Cache Check (fast-path: 0 tokens, <15ms)
    // Bypassed for system triggers (smart_reminder, proactive) which require live context and fresh tool execution
    if (!ctx.input.media && ctx.cleanUserText && !isSystemTrigger) {
      const cacheResult = await SemanticCacheEngine.getInstance().process(ctx.cleanUserText, {
        userId: ctx.input.userId,
        userName: ctx.input.userName,
        conversationId: ctx.input.conversationId,
        channel: ctx.input.channel,
        languageContext: ctx.languageContext,
      });

      if (cacheResult.type === 'hit' && cacheResult.response) {
        const conversation = await deps.chatRepo.getOrCreateConversation(ctx.input.userId, ctx.input.channel);
        const conversationId = conversation.id;
        const modelName = 'semantic-cache';

        await Promise.all([
          deps.chatRepo.saveMessage(
            conversationId,
            'user',
            ctx.input.channel === 'whatsapp' ? 'WhatsApp User' : 'User',
            ctx.cleanUserText
          ),
          deps.chatRepo.saveMessage(
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
              latencyMs: Date.now() - ctx.startTime,
            }
          ),
        ]);

        ctx.earlyExitOutput = {
          conversationId,
          agentRunId: ctx.agentRunId,
          status: 'completed',
          replyText: cacheResult.response,
          toolCallsExecuted: [],
          metrics: {
            modelUsed: modelName,
            latencyMs: Date.now() - ctx.startTime,
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: 0,
          },
          languageContext: ctx.languageContext,
          personalityContext: ctx.personalityContext,
        };
        return;
      }
    }

    // 3. User Daily Rate Limit Check (Free tier: 40 msgs/day, VIP: unlimited)
    // Bypassed for scheduled system triggers like smart_reminder and proactive
    if (!isSystemTrigger) {
      const limitCheck = await deps.userRepo.checkAndIncrementDailyLimit(
        ctx.input.userId,
        ctx.input.userPhone
      );

    if (!limitCheck.allowed) {
      logger.warn(`Daily limit exceeded for user [${ctx.input.userId}], phone [${ctx.input.userPhone || 'none'}]`);
      const conversation = await deps.chatRepo.getOrCreateConversation(ctx.input.userId, ctx.input.channel);
      const conversationId = conversation.id;
      const rateLimitReply =
        ctx.languageContext.targetLanguage === 'en'
          ? 'You have reached the daily limit of free messages (40 messages). Your balance will be refreshed tomorrow. For unlimited access, please contact support.'
          : 'لقد وصلت إلى الحد الأقصى للرسائل المجانية اليومية (40 رسالة). سيتجدد رصيدك غداً. للحصول على باقة غير محدودة، يمكنك التواصل مع الدعم.';

      await Promise.all([
        deps.chatRepo.saveMessage(
          conversationId,
          'user',
          ctx.input.channel === 'whatsapp' ? 'WhatsApp User' : 'User',
          ctx.cleanUserText || '[رسالة]'
        ),
        deps.chatRepo.saveMessage(
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
            latencyMs: Date.now() - ctx.startTime,
          }
        ),
      ]);

      ctx.earlyExitOutput = {
        conversationId,
        agentRunId: ctx.agentRunId,
        status: 'completed',
        replyText: rateLimitReply,
        toolCallsExecuted: [],
        metrics: {
          modelUsed: 'rate-limiter',
          latencyMs: Date.now() - ctx.startTime,
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
        },
        languageContext: ctx.languageContext,
        personalityContext: ctx.personalityContext,
      };
      return;
    }
    }

    // 4. If WhatsApp channel, consolidate conversations in background
    if (ctx.input.channel === 'whatsapp') {
      deps.chatRepo.consolidateWhatsAppConversations(ctx.input.userId).catch((err) => {
        logger.debug('Consolidate conversations background error', { error: err.message });
      });
    }

    // 5. Media classification & interim notifications
    const cleanMime = (ctx.input.media?.mimeType || '').split(';')[0].trim().toLowerCase();
    const isAudio =
      cleanMime.startsWith('audio/') ||
      ['.ogg', '.opus', '.mp3', '.m4a', '.aac', '.wav', '.flac', '.amr'].some((ext) =>
        (ctx.input.media?.filename || '').toLowerCase().endsWith(ext)
      );

    const cleanMimeForCheck = (ctx.input.media?.mimeType || '').toLowerCase();
    const filenameForCheck = ctx.input.media?.filename || '';
    const extForCheck = filenameForCheck.includes('.')
      ? filenameForCheck.substring(filenameForCheck.lastIndexOf('.')).toLowerCase()
      : '';
    const isImg =
      cleanMimeForCheck.startsWith('image/') ||
      ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.heic'].includes(extForCheck);

    ctx.isAudio = isAudio;
    ctx.isImage = isImg;

    if (ctx.input.media) {
      if (isAudio) ctx.mediaType = 'audio';
      else if (isImg) ctx.mediaType = 'image';
      else ctx.mediaType = 'document';

      const isEnglish = ctx.languageContext.targetLanguage === 'en';
      if (isAudio) {
        await ctx.sendInterim(
          isEnglish
            ? 'Processing audio note, one moment please. 🎙️'
            : 'جاري معالجة التسجيل الصوتي، لحظة واحدة فضلاً. 🎙️'
        );
      } else if (isImg) {
        await ctx.sendInterim(
          isEnglish
            ? 'Analyzing your image, one moment please! 👁️'
            : 'لحظات، أطّلع على الصورة وأرد عليك! 👁️'
        );
      } else {
        await ctx.sendInterim(
          isEnglish
            ? 'Reading attached file, one moment please. 📄'
            : 'لحظات، أقرأ الملف المرفق. 📄'
        );
      }
    }

    // 6. Audio transcription via Groq Whisper if audio attached
    if (ctx.input.media && isAudio) {
      const transcribed = await deps.groqProvider.transcribeAudio(
        ctx.input.media.buffer,
        cleanMime || 'audio/ogg',
        ctx.input.media.filename || 'voice_note.ogg',
        ctx.languageContext
      );
      if (transcribed) {
        ctx.textToProcess = ctx.textToProcess ? `${ctx.textToProcess}\n${transcribed}` : transcribed;
        // Re-resolve language context using transcribed audio content
        ctx.languageContext = LanguageIntelligenceService.getInstance().resolveContext(ctx.textToProcess);
      }
    }

    // 7. Concurrent text interim acknowledgement via Groq
    if (!ctx.interimSent && ctx.input.onInterimProgress && ctx.textToProcess && !ctx.input.media) {
      deps.groqProvider
        .generateInterimAcknowledgement(ctx.textToProcess, ctx.languageContext, ctx.personalityContext)
        .then(async (acknowledged) => {
          if (acknowledged && !ctx.interimSent) {
            await ctx.sendInterim(acknowledged);
          }
        })
        .catch((err) => {
          logger.debug('Concurrent interim check failed', { error: err.message });
        });
    }

    // 8. Process media attachments to build prompt and record text
    const { effectivePrompt, historyRecordText } = await processMediaAttachment(
      ctx.textToProcess,
      ctx.input.media,
      ctx.languageContext
    );
    ctx.effectivePrompt = effectivePrompt;
    ctx.historyRecordText = historyRecordText;

    // 9. Resolve active conversation
    const conversation = await deps.chatRepo.getOrCreateConversation(ctx.input.userId, ctx.input.channel);
    ctx.conversationId = ctx.input.conversationId || conversation.id;

    // 10. Image attachment payload for Groq Vision
    if (isImg && ctx.input.media) {
      ctx.imageAttachment = {
        data: ctx.input.media.buffer.toString('base64'),
        mimeType: ctx.input.media.mimeType || 'image/jpeg',
      };
    }
  }
}
