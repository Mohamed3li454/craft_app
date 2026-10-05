/**
 * Execution Engine (Phase 8.3)
 *
 * Central Control Plane for bounded, multi-step agent execution:
 * - Directs execution loop bounded by ExecutionPolicy (default 3 steps, hard max 5)
 * - Enforces sequential step chaining with intermediate verification
 * - Manages LoopGuard, FailureHandler, StepVerifier, and StepExecutor
 * - Honors confirmation barriers (halts immediately when confirmation is needed)
 * - Supports cancellation via AbortSignal and partial completion state
 */

import { logger } from '../../../core/logger';
import { GroqProvider, GroqMessage } from '../../groq/groq.provider';
import { ToolResultFormatter } from '../../tools/adapters/tool_result_formatter';
import { SearchFallbackFormatter } from '../../tools/adapters/search_fallback_formatter';
import { redactSecrets } from '../../tools/contracts/error.types';
import {
  SearchPresentationPolicy,
  SearchPresentationPolicyResolver,
  SearchContextManager,
} from '../../tools/search';
import { ChatRepository } from '../../../database/repositories/chat.repo';
import {
  AIRouter,
  AIMessage,
  AIRequest,
  SystemPromptBuilder,
  ProviderRegistry,
  GroqAIProvider,
  AIProviderError,
} from '../../ai';
import {
  AgentExecutionState,
  AgentExecutionStatus,
  ExecutionEngineContext,
  ExecutionEngineRunResult,
  ExecutionPolicy,
} from './types';
import { ExecutionPolicyManager } from './execution_policy';
import { ExecutionStateManager } from './execution_state';
import { StepVerifier } from './step_verifier';
import { LoopGuard } from './loop_guard';
import { FailureHandler } from './failure_handler';
import { StepExecutor } from './step_executor';
import { ExecutionPlanner } from './planner';
import { MetricsCollector } from '../../observability';

export class ExecutionEngine {
  private static instance: ExecutionEngine;
  private aiRouter: AIRouter;
  private groqProvider?: GroqProvider;
  private chatRepo?: ChatRepository;

  public static getInstance(): ExecutionEngine {
    if (!ExecutionEngine.instance) {
      ExecutionEngine.instance = new ExecutionEngine();
    }
    return ExecutionEngine.instance;
  }

  constructor(
    private policyManager: ExecutionPolicyManager = ExecutionPolicyManager.getInstance(),
    private stepVerifier: StepVerifier = StepVerifier.getInstance(),
    private loopGuard: LoopGuard = new LoopGuard(),
    private failureHandler: FailureHandler = FailureHandler.getInstance(),
    private stepExecutor: StepExecutor = new StepExecutor(),
    private planner: ExecutionPlanner = new ExecutionPlanner(),
    aiRouterOrGroq?: AIRouter | GroqProvider,
    chatRepo?: ChatRepository
  ) {
    this.chatRepo = chatRepo;
    if (aiRouterOrGroq instanceof GroqProvider || (aiRouterOrGroq && !(aiRouterOrGroq as any).route)) {
      const testRegistry = new ProviderRegistry();
      testRegistry.registerProvider(new GroqAIProvider(aiRouterOrGroq as any));
      this.aiRouter = new AIRouter(testRegistry);
      this.groqProvider = aiRouterOrGroq as any;
    } else if (aiRouterOrGroq) {
      this.aiRouter = aiRouterOrGroq as AIRouter;
    } else {
      this.aiRouter = AIRouter.getInstance();
    }
  }

  /**
   * Executes a bounded multi-step agent task.
   */
  public async run(
    context: ExecutionEngineContext,
    baseConversationHistory: GroqMessage[]
  ): Promise<ExecutionEngineRunResult> {
    const startTime = Date.now();
    const policy = this.policyManager.resolvePolicy(context.policy);
    const state = ExecutionStateManager.createInitialState(
      context.runId,
      `task_${context.runId.substring(0, 8)}`,
      context.userGoal,
      policy.maxSteps
    );

    this.loopGuard.reset();
    let finalReply = '';

    logger.info(`ExecutionEngine starting task [${state.taskId}] for goal: "${context.userGoal}"`, {
      maxSteps: policy.maxSteps,
      channel: context.channel,
      triggerType: context.triggerType,
      reminderId: context.reminderId,
      reminderTitle: context.reminderTitle,
    });

    // Resolve Search Presentation Policy
    const searchPresentationPolicy = SearchPresentationPolicyResolver.resolve(
      context.userGoal,
      context.recentMessages || (baseConversationHistory as any[])
    );

    // Follow-up source request shortcut: reuse previous search without re-searching
    if (searchPresentationPolicy.isFollowUpSourceRequest) {
      const previousSearch = await SearchContextManager.getLatestSearchWithDbFallback(
        context.conversationId,
        this.chatRepo
      );
      if (previousSearch && previousSearch.results && previousSearch.results.length > 0) {
        logger.info(
          `ExecutionEngine: Reusing search context for conversation [${context.conversationId}] for follow-up source request`
        );
        finalReply = SearchFallbackFormatter.formatSourceList(
          previousSearch.results,
          context.languageContext,
          { showUrls: searchPresentationPolicy.shouldShowUrls }
        );
        ExecutionStateManager.transitionStatus(state, 'completed');
        return {
          status: 'completed',
          finalReply,
          state,
          steps: [],
          toolCallsExecuted: [],
          metrics: this.computeMetrics(state, startTime),
        };
      }
    }

    // Main Sequential Execution Loop
    while (state.currentStep < policy.maxSteps) {
      // 1. Cancellation Check
      if (context.abortSignal?.aborted) {
        logger.warn(`ExecutionEngine aborted by cancellation signal during task [${state.taskId}]`);
        ExecutionStateManager.transitionStatus(state, 'cancelled', 'Operation cancelled by user or signal.');
        finalReply =
          context.languageContext?.targetLanguage === 'en'
            ? 'The operation was cancelled.'
            : 'تم إلغاء العملية.';
        break;
      }

      // 2. Total Execution Budget Check
      const budgetCheck = this.policyManager.checkBudget(state, policy, startTime);
      if (!budgetCheck.withinBudget) {
        logger.warn(`ExecutionEngine halting task [${state.taskId}]: ${budgetCheck.reason}`);
        break;
      }

      // 3. Plan Next Action via ExecutionPlanner
      const decision = await this.planner.planNextStep(state, context, baseConversationHistory);

      // 4. Handle Finish Decision
      if (decision.type === 'finish') {
        if (decision.finalAnswer) {
          finalReply = decision.finalAnswer;
        }
        break;
      }

      // 5. Handle Clarify Decision
      if (decision.type === 'clarify') {
        finalReply = decision.question;
        ExecutionStateManager.transitionStatus(state, 'partially_completed');
        break;
      }

      // 6. Handle Failure Decision
      if (decision.type === 'fail') {
        ExecutionStateManager.transitionStatus(state, 'failed', decision.reason);
        finalReply = decision.reason;
        break;
      }

      // 7. Handle Tool Call Decision
      if (decision.type === 'tool_call') {
        const { toolName, arguments: rawArgs } = decision;

        // A. LoopGuard & Idempotency Check
        const loopDecision = this.loopGuard.check(toolName, rawArgs);
        if (!loopDecision.allowed) {
          logger.warn(`LoopGuard rejected tool call [${toolName}]: ${loopDecision.reason}`);
          break;
        }

        // B. Create Step in State
        const step = ExecutionStateManager.createStep(state, toolName, rawArgs);
        MetricsCollector.getInstance().increment('craft.agent.steps', 1, { tool: toolName, channel: context.channel });

        // C. Send Interim Acknowledgment if Applicable
        if (toolName === 'web_search' && context.sendInterim && state.steps.length === 1) {
          await context.sendInterim(
            context.languageContext?.targetLanguage === 'en'
              ? 'Searching trusted sources, one moment please. 🔍'
              : 'جاري البحث في المصادر المعتمدة، لحظة واحدة فضلاً. 🔍'
          );
        }

        // D. Execute Step Strictly through StepExecutor (ToolLifecycleManager)
        const stepStartTime = Date.now();
        const lifecycleResult = await this.stepExecutor.executeStep(toolName, rawArgs, context);
        const stepDurationMs = Date.now() - stepStartTime;
        state.totalToolExecutionMs += stepDurationMs;

        // E. Confirmation Barrier: If tool requires confirmation, pause immediately!
        if (lifecycleResult.status === 'confirmation_required') {
          logger.info(`Step [${step.id}] requires confirmation. Halting subsequent steps.`);
          ExecutionStateManager.completeStep(
            step,
            'waiting_confirmation',
            lifecycleResult.rawResult,
            undefined,
            undefined,
            stepDurationMs
          );
          step.verification = this.stepVerifier.verify(toolName, lifecycleResult);
          ExecutionStateManager.transitionStatus(state, 'waiting_confirmation');

          return {
            status: 'waiting_confirmation',
            finalReply: '', // Will be populated with confirmation notice by caller
            state,
            steps: state.steps,
            toolCallsExecuted: this.formatExecutedToolCalls(state),
            confirmationRequest: {
              token: '', // Handled by caller's ConfirmationService
              actionName: toolName,
              description: '',
              expiresAt: '',
            },
            metrics: this.computeMetrics(state, startTime),
          };
        }

        // F. Step Verification
        const verification = this.stepVerifier.verify(toolName, lifecycleResult);
        step.verification = verification;

        if (lifecycleResult.status === 'completed') {
          state.totalToolCalls++;
          this.loopGuard.record(toolName, rawArgs);

          if (toolName === 'web_search' && lifecycleResult.rawResult) {
            SearchContextManager.setLatestSearch(
              context.conversationId,
              rawArgs.query || context.userGoal,
              lifecycleResult.rawResult
            );
          }

          ExecutionStateManager.completeStep(
            step,
            'succeeded',
            lifecycleResult.rawResult,
            lifecycleResult.serializedForLLM,
            undefined,
            stepDurationMs
          );

          // If reached max tool calls, halt loop for synthesis
          if (state.totalToolCalls >= policy.maxToolCalls || state.currentStep >= policy.maxSteps) {
            logger.info(`Task [${state.taskId}] reached allowed step/tool limits. Moving to synthesis.`);
            break;
          }
        } else {
          // Failure or Denial
          ExecutionStateManager.completeStep(
            step,
            'failed',
            undefined,
            undefined,
            lifecycleResult.error,
            stepDurationMs
          );

          const failureResolution = this.failureHandler.handleFailure(step, state, policy);
          logger.warn(`Step [${step.id}] failed. Recovery: ${failureResolution.strategy}`);

          if (failureResolution.strategy === 'retry') {
            step.retryCount = 1;
            const retryRes = await this.stepExecutor.executeStep(toolName, rawArgs, context);
            if (retryRes.status === 'completed') {
              state.totalToolCalls++;
              this.loopGuard.record(toolName, rawArgs);
              if (toolName === 'web_search' && retryRes.rawResult) {
                SearchContextManager.setLatestSearch(
                  context.conversationId,
                  rawArgs.query || context.userGoal,
                  retryRes.rawResult
                );
              }
              ExecutionStateManager.completeStep(
                step,
                'succeeded',
                retryRes.rawResult,
                retryRes.serializedForLLM,
                undefined,
                Date.now() - stepStartTime
              );
              step.verification = this.stepVerifier.verify(toolName, retryRes);
              continue;
            }
          }

          if (
            failureResolution.strategy === 'abort_to_failure' ||
            failureResolution.strategy === 'abort_to_partial_synthesis'
          ) {
            break;
          }
        }
      }
    }

    // 8. Determine Final Execution Status
    const successfulSteps = state.steps.filter((s) => s.status === 'succeeded');
    const failedSteps = state.steps.filter((s) => s.status === 'failed');

    let finalStatus: AgentExecutionStatus = 'completed';
    if (state.status === 'cancelled') {
      finalStatus = 'cancelled';
    } else if (successfulSteps.length === 0 && failedSteps.length > 0) {
      finalStatus = 'failed';
    } else if (successfulSteps.length > 0 && failedSteps.length > 0) {
      finalStatus = 'partially_completed';
    } else if (state.steps.length === 0) {
      finalStatus = 'completed';
    }

    ExecutionStateManager.transitionStatus(state, finalStatus);

    if (finalStatus === 'partially_completed') {
      MetricsCollector.getInstance().increment('craft.agent.partial', 1, { channel: context.channel });
    } else if (finalStatus === 'failed') {
      MetricsCollector.getInstance().increment('craft.agent.failed', 1, { channel: context.channel });
    } else if (finalStatus === 'cancelled') {
      MetricsCollector.getInstance().increment('craft.agent.cancelled', 1, { channel: context.channel });
    }

    // 9. Generate Final Response Synthesis if not already produced by Planner
    if (!finalReply || finalReply.trim().length === 0 || finalReply.startsWith('Called tool:')) {
      finalReply = await this.synthesizeFinalAnswer(
        state,
        context,
        baseConversationHistory,
        finalStatus,
        searchPresentationPolicy
      );
    }

    // 10. Code-Layer Leak Guard: prevent unrequested raw search dumps
    const hasSearchStep = state.steps.some(
      (s) => s.toolName === 'web_search' && s.status === 'succeeded'
    );
    if (hasSearchStep && !searchPresentationPolicy.shouldShowSources && finalReply) {
      finalReply = SearchPresentationPolicyResolver.sanitizeResponseIfLeaked(
        finalReply,
        searchPresentationPolicy,
        context.languageContext
      );
    }

    const durationMs = Date.now() - startTime;
    logger.info(`ExecutionEngine finished task [${state.taskId}] with status [${finalStatus}] in ${durationMs}ms`, {
      stepsCount: state.steps.length,
      toolCalls: state.totalToolCalls,
      triggerType: context.triggerType,
    });

    return {
      status: finalStatus,
      finalReply,
      state,
      steps: state.steps,
      toolCallsExecuted: this.formatExecutedToolCalls(state),
      metrics: this.computeMetrics(state, startTime),
    };
  }

  /**
   * Synthesizes final response text based on the verified execution state and results.
   */
  private async synthesizeFinalAnswer(
    state: AgentExecutionState,
    context: ExecutionEngineContext,
    baseConversationHistoryOrStatus: GroqMessage[] | string,
    statusOrPolicy?: AgentExecutionStatus | SearchPresentationPolicy,
    searchPresentationPolicy?: SearchPresentationPolicy
  ): Promise<string> {
    const isLegacyCall = typeof baseConversationHistoryOrStatus === 'string' && searchPresentationPolicy === undefined;
    const baseConversationHistory = Array.isArray(baseConversationHistoryOrStatus) ? baseConversationHistoryOrStatus : [];
    const status: AgentExecutionStatus = typeof baseConversationHistoryOrStatus === 'string'
      ? (baseConversationHistoryOrStatus as AgentExecutionStatus)
      : (typeof statusOrPolicy === 'string' ? statusOrPolicy : 'completed');
    const policy = searchPresentationPolicy || (isLegacyCall ? undefined : SearchPresentationPolicyResolver.resolve(context.userGoal));

    const isEnglish = context.languageContext?.targetLanguage === 'en';

    if (state.steps.length === 0) {
      return isEnglish ? 'Your request was processed successfully.' : 'تمت معالجة طلبك بنجاح.';
    }

    // Build synthesized observations
    const observationSnippets: string[] = [];
    for (const step of state.steps) {
      if (step.status === 'succeeded') {
        const serialized =
          step.serializedResult ||
          (typeof step.result === 'object' ? JSON.stringify(step.result) : String(step.result));
        observationSnippets.push(`[Verified Result: ${step.toolName}]\n${serialized}`);
      } else if (step.status === 'failed') {
        observationSnippets.push(
          `[Failed Step: ${step.toolName}]\nReason: ${step.error?.userSafeMessage || step.error?.message || 'Action could not be completed'}`
        );
      }
    }

    const observationsBlock = observationSnippets.join('\n\n');

    let instruction = '';
    if (status === 'partially_completed') {
      instruction = isEnglish
        ? `Task concluded with partial completion. Explain clearly what was accomplished and what failed based on the observations below. State the facts accurately and do not claim full success.`
        : `انتهت المهمة بإنجاز جزئي. وضح للمستخدم بصدق ودقة ما تم إنجازه بنجاح وما تعذر تنفيذه مع توضيح السبب بناءً على النتائج أدناه، ولا تدّعِ اكتمال كل شيء.`;
    } else if (status === 'failed') {
      instruction = isEnglish
        ? `Task execution failed. Explain the issue politely and provide actionable advice based on the errors below.`
        : `تعذر إتمام الإجراء. اشرح للمستخدم المشكلة بأدب ووضوح واقترح عليه ما يمكن فعله.`;
    } else {
      instruction = isEnglish
        ? `Based on the verified tool results above, answer the user's question directly, clearly, and concisely in fluent English.`
        : `بناءً على نتائج الأدوات الموثقة أعلاه، أجب عن سؤال المستخدم أو أكد تنفيذ طلبه بأسلوب واضح ومباشر.`;
    }

    let synthesisContent = '';
    if (state.steps.length === 1 && state.steps[0].status === 'succeeded') {
      synthesisContent = ToolResultFormatter.buildSynthesisPrompt(
        state.steps[0].toolName,
        state.steps[0].serializedResult || JSON.stringify(state.steps[0].result),
        context.languageContext,
        policy
      );
    } else {
      const hasSearch = state.steps.some((s) => s.toolName === 'web_search');
      if (hasSearch && !policy?.shouldShowSources) {
        instruction += isEnglish
          ? ` Answer naturally and directly based on the verified facts above. Do NOT include raw search result listings, do NOT dump URLs, and do NOT list sources unless explicitly requested.`
          : ` أجب بأسلوب طبيعي ومباشر من واقع الحقائق الموثقة أعلاه. إياك وسرد نتائج البحث الخام أو وضع روابط أو مصادر للمستخدم لأن المستخدم لم يطلبها.`;
      }
      synthesisContent = `[Execution Outcomes from Verified Tools]:\n${observationsBlock}\n\n[Instruction]:\n${instruction}`;
    }

    const systemInstruction = SystemPromptBuilder.buildSystemInstruction(
      context.memories,
      context.languageContext,
      context.personalityContext,
      context.personalizationPolicy,
      context.adaptiveResponsePolicy,
      context.proactivePolicy
    );

    const synthesisRequest: AIRequest = {
      messages: [
        { role: 'system', content: systemInstruction },
        ...(baseConversationHistory as AIMessage[]),
        {
          role: 'user',
          content: synthesisContent,
        },
      ],
      metadata: {
        runId: context.runId,
        userId: context.userId,
        conversationId: context.conversationId,
        channel: context.channel,
      },
      signal: context.abortSignal,
    };

    try {
      const synthesisRes = await this.aiRouter.route(synthesisRequest);

      if (synthesisRes.usage) {
        state.promptTokens += synthesisRes.usage.promptTokens;
        state.completionTokens += synthesisRes.usage.completionTokens;
        state.totalTokens += synthesisRes.usage.totalTokens;
      }

      const text = typeof synthesisRes.message.content === 'string'
        ? synthesisRes.message.content.trim()
        : '';

      if (text.length > 0) {
        return text;
      }

      throw new AIProviderError({
        providerId: (synthesisRes as any)?.providerId || 'groq',
        category: 'malformed_response',
        message: 'Synthesis model returned empty response content',
        retryable: false,
      });
    } catch (err: any) {
      const category = err instanceof AIProviderError ? err.category : (err?.category || 'unknown');
      const providerId = err instanceof AIProviderError ? err.providerId : (err?.providerId || 'groq');

      logger.warn('AI Router synthesis failed in ExecutionEngine, evaluating fallback recovery', {
        category,
        providerId,
        error: redactSecrets(err?.message || 'Unknown synthesis failure'),
      });

      // Zero-Loss Requirement: Check if state contains successful web_search results
      const searchStep = [...state.steps]
        .reverse()
        .find((s) => s.toolName === 'web_search' && s.status === 'succeeded');

      if (searchStep && (searchStep.result || searchStep.serializedResult)) {
        MetricsCollector.getInstance().increment('craft.search.deterministic_fallback_invoked', 1, {
          reason: category,
          provider: providerId,
        });

        if (isLegacyCall) {
          const fallbackReply = SearchFallbackFormatter.format(
            searchStep.result || searchStep.serializedResult,
            context.languageContext
          );
          if (fallbackReply && fallbackReply.trim().length > 0) {
            return fallbackReply;
          }
        } else if (policy?.shouldShowSources) {
          const fallbackReply = SearchFallbackFormatter.formatSourceList(
            searchStep.result || searchStep.serializedResult,
            context.languageContext,
            { showUrls: policy.shouldShowUrls }
          );

          if (fallbackReply && fallbackReply.trim().length > 0) {
            logger.info('Successfully generated requested search source list after synthesis failure');
            return fallbackReply;
          }
        } else {
          // Safe conversational fallback without raw results dump!
          const safeFallback = SearchFallbackFormatter.formatFailureFallback(context.languageContext);
          logger.info('Successfully generated safe conversational fallback without raw search dump');
          return safeFallback;
        }
      }

      logger.error('Failed to generate final synthesis in ExecutionEngine and no search fallback available', {
        error: redactSecrets(err?.message || 'Unknown error'),
      });
      return isEnglish
        ? 'Your request was processed, but an error occurred while summarizing the results.'
        : 'تمت معالجة طلبك، ولكن حدث خطأ أثناء تلخيص النتائج النهائية.';
    }
  }

  /**
   * Formats executed tool calls for persistence and downstream reporting.
   */
  private formatExecutedToolCalls(
    state: AgentExecutionState
  ): Array<{ toolName: string; arguments: Record<string, any>; result: any }> {
    return state.steps.map((s) => ({
      toolName: s.toolName,
      arguments: s.input,
      result: s.result || s.error,
    }));
  }

  /**
   * Computes execution metrics.
   */
  private computeMetrics(
    state: AgentExecutionState,
    startTime: number
  ): ExecutionEngineRunResult['metrics'] {
    const totalDurationMs = Date.now() - startTime;
    const engineOverheadMs = Math.max(0, totalDurationMs - state.totalToolExecutionMs);

    return {
      stepsExecuted: state.steps.length,
      totalToolCalls: state.totalToolCalls,
      totalDurationMs,
      engineOverheadMs,
      promptTokens: state.promptTokens,
      completionTokens: state.completionTokens,
      totalTokens: state.totalTokens,
    };
  }
}
