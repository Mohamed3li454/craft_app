/**
 * Execution Stage (Phase 8.3)
 *
 * Coordinates multi-step agent execution through ExecutionEngine:
 * - History & memory formatting bounded by Token Budget Manager
 * - Sequential multi-step execution bounded by ExecutionPolicy
 * - Loop protection & mutation idempotency
 * - Intermediate step verification
 * - Sensitive tool confirmation gating (hard barrier)
 * - Safe fallback error handling & analytics persistence
 */

import { logger } from '../../../../core/logger';
import { GroqMessage } from '../../../groq/groq.provider';
import { AgentPipelineContext, AgentPipelineDependencies, PipelineStage } from '../types';
import { formatGroqConversationHistory } from '../helpers';
import { ToolResultFormatter } from '../../../tools/adapters/tool_result_formatter';
import { ExecutionEngine, ExecutionEngineContext } from '../../execution';

export class ExecutionStage implements PipelineStage {
  public readonly name = 'execution';

  public async execute(ctx: AgentPipelineContext, deps: AgentPipelineDependencies): Promise<void> {
    // 1. Truncate conversation history according to Centralized Token Budget Manager
    const boundedMessages = ctx.tokenBudgetResult
      ? deps.tokenBudgetManager.truncateHistory(
          ctx.recentMessages,
          ctx.tokenBudgetResult.maxHistoryTurns,
          ctx.tokenBudgetResult.maxHistoryChars
        )
      : ctx.recentMessages;

    const groqMessages: GroqMessage[] = formatGroqConversationHistory(
      boundedMessages,
      ctx.effectivePrompt
    );

    const groqMemories =
      ctx.memoryContext && ctx.memoryContext.selectedCount > 0
        ? ctx.memoryContext.memories.map((m) => m.memory.factText)
        : undefined;

    const executionEngine = deps.executionEngine || ExecutionEngine.getInstance();

    const engineContext: ExecutionEngineContext = {
      runId: ctx.agentRunId,
      userId: ctx.input.userId,
      conversationId: ctx.conversationId,
      channel: ctx.input.channel,
      userGoal: ctx.effectivePrompt,
      languageContext: ctx.languageContext,
      personalityContext: ctx.personalityContext,
      personalizationPolicy: ctx.personalizationPolicy,
      adaptiveResponsePolicy: ctx.adaptiveResponsePolicy,
      proactivePolicy: ctx.proactivePolicy,
      tokenBudgetResult: ctx.tokenBudgetResult,
      memories: groqMemories,
      imageAttachment: ctx.imageAttachment,
      recentMessages: ctx.recentMessages,
      triggerType: ctx.triggerType,
      reminderId: ctx.reminderId,
      reminderTitle: ctx.reminderTitle,
      sendInterim: async (msg: string) => {
        await ctx.sendInterim(msg);
      },
    };

    try {
      const engineResult = await executionEngine.run(engineContext, groqMessages);

      // Record accumulated token usage
      ctx.accumulatedPromptTokens += engineResult.metrics.promptTokens;
      ctx.accumulatedCompletionTokens += engineResult.metrics.completionTokens;
      ctx.accumulatedTotalTokens += engineResult.metrics.totalTokens;

      // 1. Sensitive Action Confirmation Barrier
      if (engineResult.status === 'waiting_confirmation') {
        const pendingStep = engineResult.steps.find((s) => s.status === 'waiting_confirmation');
        const toolName = pendingStep?.toolName || 'action';
        const effectiveArgs = pendingStep?.input || {};
        const isEnglish = ctx.languageContext.targetLanguage === 'en';

        const confirmation = await deps.confirmationService.createConfirmationRequest(
          ctx.agentRunId,
          ctx.input.userId,
          toolName,
          isEnglish ? `Confirmation request for action: ${toolName}` : `طلب تأكيد لتنفيذ عملية: ${toolName}`,
          effectiveArgs,
          ctx.conversationId
        );

        const promptNotice = ToolResultFormatter.formatConfirmationNotice(
          toolName,
          effectiveArgs,
          confirmation.token,
          ctx.languageContext
        );

        await deps.chatRepo.saveMessage(ctx.conversationId, 'assistant', 'Craft', promptNotice);

        ctx.status = 'waiting_for_confirmation';
        ctx.finalReply = promptNotice;
        ctx.confirmationRequest = {
          token: confirmation.token,
          actionName: confirmation.actionName,
          description: confirmation.description,
          expiresAt: confirmation.expiresAt.toISOString(),
        };
        return;
      }

      // 2. Append executed tool calls to pipeline context
      for (const executed of engineResult.toolCallsExecuted) {
        ctx.toolCallsExecuted.push(executed);
      }

      // 3. Persist tool calls to database for analytics
      for (const step of engineResult.steps) {
        deps.chatRepo
          .saveToolCall(
            ctx.agentRunId,
            ctx.conversationId,
            step.toolName,
            step.input,
            step.result || null,
            step.status === 'succeeded' ? 'success' : 'failed',
            step.error?.message
          )
          .catch((err) =>
            logger.warn('Failed to persist tool call to database', {
              error: err.message,
              toolName: step.toolName,
            })
          );
      }

      // 4. Set final reply and status
      ctx.finalReply = engineResult.finalReply;
      ctx.status = engineResult.status === 'failed' ? 'failed' : 'completed';
    } catch (engineErr: any) {
      logger.error('ExecutionEngine execution failed', { error: engineErr.message });
      ctx.finalReply =
        ctx.languageContext.targetLanguage === 'en'
          ? 'A temporary connection error occurred. Please try sending your request again.'
          : 'حدث خطأ مؤقت في الاتصال. يرجى محاولة إرسال طلبك مرة أخرى.';
    }

    if (
      !ctx.finalReply ||
      ctx.finalReply.trim().startsWith('Called tool:') ||
      ctx.finalReply.trim().startsWith('Tool [')
    ) {
      ctx.finalReply =
        ctx.languageContext.targetLanguage === 'en'
          ? 'A temporary connection error occurred. Please try sending your request again.'
          : 'حدث خطأ مؤقت في الاتصال. يرجى محاولة إرسال طلبك مرة أخرى.';
    }
  }
}
