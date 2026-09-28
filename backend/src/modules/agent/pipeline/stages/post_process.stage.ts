/**
 * Post-Process Stage (Phase 8.1)
 *
 * Handles formatting normalization, persistence, and learning hooks:
 * - WhatsApp formatting cleanup
 * - Interim suppression
 * - Database message & metrics persistence
 * - Non-blocking Learning Pipeline observation (Phase 5)
 */

import { logger } from '../../../../core/logger';
import { cleanWhatsAppText } from '../../../whatsapp/formatter';
import { LearningPipeline } from '../../../cache/learning/learning_pipeline';
import { AgentPipelineContext, AgentPipelineDependencies, PipelineStage } from '../types';

export class PostProcessStage implements PipelineStage {
  public readonly name = 'post_process';

  public async execute(ctx: AgentPipelineContext, deps: AgentPipelineDependencies): Promise<void> {
    // 1. Clean and harmonize formatting for WhatsApp and mobile viewing
    ctx.finalReply = cleanWhatsAppText(ctx.finalReply);

    // 2. Prevent any late background interim messages from firing after final answer
    ctx.interimSent = true;

    const latencyMs = Date.now() - ctx.startTime;

    // 3. Persist assistant reply with full analytics metadata
    await deps.chatRepo.saveMessage(
      ctx.conversationId,
      'assistant',
      'Craft',
      ctx.finalReply,
      undefined,
      {
        tokensUsed: ctx.accumulatedTotalTokens,
        promptTokens: ctx.accumulatedPromptTokens,
        completionTokens: ctx.accumulatedCompletionTokens,
        modelName: ctx.lastModelUsed,
        latencyMs,
        toolsUsed: ctx.toolCallsExecuted.map((t) => t.toolName).join(', ') || undefined,
      }
    );

    // 4. Safe, non-blocking learning observer hook
    LearningPipeline.getInstance()
      .observeRun({
        runId: ctx.agentRunId,
        userInput: ctx.cleanUserText,
        replyText: ctx.finalReply,
        toolCalls: ctx.toolCallsExecuted,
        modelUsed: ctx.lastModelUsed,
        provider: ctx.lastProviderUsed || 'groq',
        channel: ctx.input.channel,
      })
      .catch((learningErr) => {
        logger.debug('LearningPipeline background observer error (safely swallowed)', {
          error: learningErr.message,
        });
      });
  }
}
