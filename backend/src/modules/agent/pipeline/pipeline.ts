/**
 * Composable Agent Pipeline (Phase 8.1)
 *
 * Replaces monolithic agent execution with modular, testable stages:
 * Preflight -> Cognitive -> Execution -> PostProcess
 */

import { v4 as uuidv4 } from 'uuid';
import { logger } from '../../../core/logger';
import { config } from '../../../config/env';
import { GroqProvider } from '../../groq/groq.provider';
import { AIRouter, AIProvider, ProviderRegistry, GroqAIProvider } from '../../ai';
import { ToolRegistry } from '../../tools/registry';
import { ToolLifecycleManager } from '../../tools/lifecycle/tool_lifecycle';
import { ExecutionEngine } from '../execution/execution_engine';
import { ConfirmationService } from '../../confirmation/confirmation.service';
import { ChatRepository } from '../../../database/repositories/chat.repo';
import { MemoryRepository } from '../../../database/repositories/memory.repo';
import { UserRepository } from '../../../database/repositories/user.repo';
import { UserPreferenceRepository } from '../../../database/repositories/user_preference.repo';
import { LanguageIntelligenceService } from '../../language';
import { PersonalityEngine } from '../../personality';
import { TokenBudgetManager } from '../../context';
import {
  AgentPipelineContext,
  AgentPipelineDependencies,
  AgentRunInput,
  AgentRunOutput,
  PipelineStage,
} from './types';
import { PreflightStage } from './stages/preflight.stage';
import { CognitiveStage } from './stages/cognitive.stage';
import { ExecutionStage } from './stages/execution.stage';
import { PostProcessStage } from './stages/post_process.stage';

import {
  TraceContextManager,
  Tracer,
  MetricsCollector,
} from '../../observability';

export class AgentPipeline {
  private readonly deps: AgentPipelineDependencies;
  private readonly stages: PipelineStage[];

  constructor(dependencies?: Partial<AgentPipelineDependencies>) {
    const groqProvider = dependencies?.groqProvider ?? new GroqProvider();
    let aiRouter = dependencies?.aiRouter;
    if (!aiRouter) {
      if (dependencies?.groqProvider) {
        // If caller passed a custom/mock groqProvider, bind it into a dedicated test router
        const testRegistry = new ProviderRegistry();
        testRegistry.registerProvider(new GroqAIProvider(dependencies.groqProvider));
        aiRouter = new AIRouter(testRegistry);
      } else {
        aiRouter = AIRouter.getInstance();
      }
    }

    this.deps = {
      aiRouter,
      aiProvider: dependencies?.aiProvider || aiRouter.getRegistry().getProvider('groq'),
      groqProvider,
      toolRegistry: dependencies?.toolRegistry ?? ToolRegistry.getInstance(),
      confirmationService: dependencies?.confirmationService ?? new ConfirmationService(),
      chatRepo: dependencies?.chatRepo ?? new ChatRepository(),
      memoryRepo: dependencies?.memoryRepo ?? new MemoryRepository(),
      userRepo: dependencies?.userRepo ?? new UserRepository(),
      userPreferenceRepo: dependencies?.userPreferenceRepo ?? new UserPreferenceRepository(),
      tokenBudgetManager: dependencies?.tokenBudgetManager ?? TokenBudgetManager.getInstance(),
      toolLifecycleManager: dependencies?.toolLifecycleManager ?? ToolLifecycleManager.getInstance(),
      executionEngine: dependencies?.executionEngine ?? ExecutionEngine.getInstance(),
    };

    this.stages = [
      new PreflightStage(),
      new CognitiveStage(),
      new ExecutionStage(),
      new PostProcessStage(),
    ];
  }

  public async execute(input: AgentRunInput): Promise<AgentRunOutput> {
    const startTime = Date.now();
    const agentRunId = uuidv4();
    const cleanUserText = (input.text || '').trim();
    const correlationId = input.correlationId || TraceContextManager.getCorrelationId();

    const metrics = MetricsCollector.getInstance();
    const tracer = Tracer.getInstance();
    metrics.increment('craft.agent.runs', 1, { channel: input.channel });

    logger.info(`Starting Agent Pipeline [${agentRunId}] on channel [${input.channel}]`, {
      userId: input.userId,
      hasMedia: !!input.media,
      correlationId,
    });

    let interimSent = false;
    const sendInterim = async (msg: string) => {
      if (interimSent || !input.onInterimProgress || !msg) return;
      interimSent = true;
      try {
        await input.onInterimProgress(msg);
      } catch (err: any) {
        logger.warn('Failed to dispatch interim progress message', { error: err.message });
      }
    };

    const resolvedModel = this.deps.aiRouter
      ? this.deps.aiRouter.resolveActiveModelId()
      : config.groq.primaryModel;
    const resolvedProvider = this.deps.aiRouter
      ? this.deps.aiRouter.getPolicyManager().getDefaultPolicy().primaryProvider
      : 'groq';

    // Initialize pipeline context
    const ctx: AgentPipelineContext = {
      input,
      correlationId,
      agentRunId,
      startTime,
      cleanUserText,

      channel: input.channel,
      conversationId: input.conversationId || '',
      textToProcess: cleanUserText,
      mediaType: 'text',
      isAudio: false,
      isImage: false,
      effectivePrompt: cleanUserText,
      historyRecordText: cleanUserText,
      interimSent: false,
      sendInterim,

      languageContext: LanguageIntelligenceService.getInstance().resolveContext(cleanUserText),
      personalityContext: PersonalityEngine.getInstance().getDefaultPersonality(),
      recentMessages: [],

      toolCallsExecuted: [],
      finalReply: '',
      lastModelUsed: resolvedModel,
      lastProviderUsed: resolvedProvider,
      accumulatedPromptTokens: 0,
      accumulatedCompletionTokens: 0,
      accumulatedTotalTokens: 0,
      status: 'completed',
    };

    const traceCtx = TraceContextManager.forkContext(
      TraceContextManager.getActiveContext() ||
        TraceContextManager.createRootContext({
          correlationId,
          channel: input.channel,
          userId: input.userId,
          conversationId: input.conversationId,
        }),
      {
        correlationId,
        runId: agentRunId,
        channel: input.channel,
        userId: input.userId,
        conversationId: input.conversationId,
      }
    );

    return TraceContextManager.runWithContext(traceCtx, async () => {
      return tracer.withSpan('pipeline.run', async (span) => {
        span.setAttributes({
          channel: input.channel,
          hasMedia: !!input.media,
          runId: agentRunId,
          correlationId,
        });

        // 1. Preflight Stage
        await tracer.withSpan('pipeline.preflight', async () => {
          await this.stages[0].execute(ctx, this.deps);
        });
        if (ctx.earlyExitOutput) {
          const latencyMs = Date.now() - startTime;
          metrics.observe('craft.pipeline.latency', latencyMs, { channel: input.channel, status: 'exit' });
          return ctx.earlyExitOutput;
        }

        // 2. Cognitive Stage
        await tracer.withSpan('pipeline.cognitive', async () => {
          await this.stages[1].execute(ctx, this.deps);
        });

        // 3. Execution Stage
        await tracer.withSpan('pipeline.execution', async () => {
          await this.stages[2].execute(ctx, this.deps);
        });

        if (ctx.status === 'waiting_for_confirmation') {
          const latencyMs = Date.now() - startTime;
          metrics.observe('craft.pipeline.latency', latencyMs, { channel: input.channel, status: 'confirmation' });
          return {
            conversationId: ctx.conversationId,
            agentRunId: ctx.agentRunId,
            status: 'waiting_for_confirmation',
            replyText: ctx.finalReply,
            toolCallsExecuted: ctx.toolCallsExecuted,
            confirmationRequest: ctx.confirmationRequest,
            metrics: {
              modelUsed: ctx.lastModelUsed,
              latencyMs,
              promptTokens: ctx.accumulatedPromptTokens,
              completionTokens: ctx.accumulatedCompletionTokens,
              totalTokens: ctx.accumulatedTotalTokens,
            },
            languageContext: ctx.languageContext,
            personalityContext: ctx.personalityContext,
            conversationState: ctx.conversationState,
            adaptiveResponsePolicy: ctx.adaptiveResponsePolicy,
            proactivePolicy: ctx.proactivePolicy,
          };
        }

        // 4. Post-Process Stage
        await tracer.withSpan('pipeline.post_process', async () => {
          await this.stages[3].execute(ctx, this.deps);
        });

        const latencyMs = Date.now() - startTime;
        metrics.observe('craft.pipeline.latency', latencyMs, { channel: input.channel, status: ctx.status });
        logger.info(`Agent Pipeline [${agentRunId}] completed successfully in ${latencyMs}ms`);

        return {
          conversationId: ctx.conversationId,
          agentRunId: ctx.agentRunId,
          status: 'completed',
          replyText: ctx.finalReply,
          toolCallsExecuted: ctx.toolCallsExecuted,
          metrics: {
            modelUsed: ctx.lastModelUsed,
            latencyMs,
            promptTokens: ctx.accumulatedPromptTokens,
            completionTokens: ctx.accumulatedCompletionTokens,
            totalTokens: ctx.accumulatedTotalTokens,
          },
          languageContext: ctx.languageContext,
          personalityContext: ctx.personalityContext,
          conversationState: ctx.conversationState,
          adaptiveResponsePolicy: ctx.adaptiveResponsePolicy,
          proactivePolicy: ctx.proactivePolicy,
        };
      });
    });
  }

  /**
   * For testing or inspection: access underlying dependencies.
   */
  public getDependencies(): Readonly<AgentPipelineDependencies> {
    return this.deps;
  }
}
