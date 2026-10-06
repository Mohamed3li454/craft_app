/**
 * Execution Planner (Phase 8.3 / Modernized in Phase 8.4)
 *
 * Directs sequential step decisions using vendor-neutral AI Provider abstraction:
 * - Bounded decision boundary: tool_call | finish | clarify | fail
 * - Formats prior step results safely as data context for the next step decision
 * - Never executes tools directly (pure planning responsibility)
 * - Provider-agnostic via AIRouter
 */

import { GroqProvider } from '../../groq/groq.provider';
import { logger } from '../../../core/logger';
import { AgentExecutionState, ExecutionDecision, ExecutionEngineContext } from './types';
import { redactSecrets } from '../../tools/contracts/error.types';
import { ToolRegistry } from '../../tools/registry';
import { ToolCapabilityPolicy } from '../../tools/safety/tool_capability_policy';
import {
  AIRouter,
  AIMessage,
  AIRequest,
  SystemPromptBuilder,
  ProviderRegistry,
  GroqAIProvider,
} from '../../ai';

export class ExecutionPlanner {
  private aiRouter: AIRouter;

  constructor(
    aiRouterOrGroq?: AIRouter | GroqProvider,
    private toolRegistry: ToolRegistry = ToolRegistry.getInstance(),
    private capabilityPolicy: ToolCapabilityPolicy = ToolCapabilityPolicy.getInstance()
  ) {
    if (aiRouterOrGroq instanceof GroqProvider || (aiRouterOrGroq && !(aiRouterOrGroq as any).route)) {
      const testRegistry = new ProviderRegistry();
      testRegistry.registerProvider(new GroqAIProvider(aiRouterOrGroq as any));
      this.aiRouter = new AIRouter(testRegistry);
    } else if (aiRouterOrGroq) {
      this.aiRouter = aiRouterOrGroq as AIRouter;
    } else {
      this.aiRouter = AIRouter.getInstance();
    }
  }

  /**
   * Decides the next bounded action based on current state and previous step outcomes.
   */
  public async planNextStep(
    state: AgentExecutionState,
    context: ExecutionEngineContext,
    conversationHistory: AIMessage[]
  ): Promise<ExecutionDecision> {
    // 1. If max steps reached, force finish
    if (state.currentStep >= state.maxSteps) {
      return { type: 'finish' };
    }

    // 2. Synthesize System Instruction using vendor-neutral builder
    const structuredInstruction = SystemPromptBuilder.buildStructuredSystemInstruction(
      context.memories,
      context.languageContext,
      context.personalityContext,
      context.personalizationPolicy,
      context.adaptiveResponsePolicy,
      context.proactivePolicy
    );

    logger.debug('[ExecutionPlanner] System instruction synthesized', {
      runId: context.runId,
      step: state.currentStep,
      prefixHash: structuredInstruction.prefixHash,
    });

    // 3. Build normalized messages: System prompt + conversation history + execution steps taken so far
    const messages: AIMessage[] = [
      { role: 'system', content: structuredInstruction.fullInstruction },
      ...conversationHistory,
    ];

    // Append prior execution steps as structured context turns
    for (const step of state.steps) {
      if (step.status === 'succeeded' || step.status === 'partial') {
        messages.push({
          role: 'assistant',
          content: `Called tool: ${step.toolName} with parameters: ${JSON.stringify(step.input)}`,
        });

        const outcomeText =
          step.serializedResult ||
          (typeof step.result === 'object' ? JSON.stringify(step.result) : String(step.result || 'Success'));

        messages.push({
          role: 'user',
          content: `[Observation for tool "${step.toolName}"]:\n${redactSecrets(outcomeText)}`,
        });
      } else if (step.status === 'failed') {
        messages.push({
          role: 'assistant',
          content: `Called tool: ${step.toolName}`,
        });
        messages.push({
          role: 'user',
          content: `[Tool Error for "${step.toolName}"]: ${step.error?.userSafeMessage || step.error?.message || 'Execution failed'}. Please decide if an alternative step is required or finish with explanation.`,
        });
      }
    }

    // Append image attachment to last user message if on first step
    const isFirstStep = state.steps.length === 0;
    if (isFirstStep && context.imageAttachment && messages.length > 0) {
      const lastUserIdx = messages.map((m) => m.role).lastIndexOf('user');
      if (lastUserIdx >= 0) {
        const existingText = typeof messages[lastUserIdx].content === 'string'
          ? (messages[lastUserIdx].content as string)
          : '';
        messages[lastUserIdx] = {
          role: 'user',
          content: [
            { type: 'text', text: existingText || 'Attached image analysis' },
            {
              type: 'image_url',
              image_url: {
                url: `data:${context.imageAttachment.mimeType};base64,${context.imageAttachment.data}`,
              },
            },
          ],
        };
      }
    }

    // 4. Construct normalized AIRequest with adaptive tools (Phase 14.3)
    const tools = this.capabilityPolicy.getAdaptiveFilteredOpenAITools(
      this.toolRegistry,
      context.triggerType,
      state.goal || context.userGoal,
      {
        hasPriorSteps: state.steps.length > 0,
        recentMessages: context.recentMessages,
      }
    );
    const aiRequest: AIRequest = {
      messages,
      tools: tools.length > 0 ? (tools as any) : undefined,
      toolChoice: tools.length > 0 ? 'auto' : undefined,
      metadata: {
        runId: context.runId,
        userId: context.userId,
        conversationId: context.conversationId,
        channel: context.channel,
        step: state.currentStep,
      },
      signal: context.abortSignal,
    };

    // 5. Query AI Router
    const aiResponse = await this.aiRouter.route(aiRequest);

    // Record token usage into state
    if (aiResponse.usage) {
      state.promptTokens += aiResponse.usage.promptTokens;
      state.completionTokens += aiResponse.usage.completionTokens;
      state.totalTokens += aiResponse.usage.totalTokens;
    }

    // 6. Parse normalized AI response into bounded ExecutionDecision
    if (aiResponse.toolCalls && aiResponse.toolCalls.length > 0) {
      const tc = aiResponse.toolCalls[0];
      return {
        type: 'tool_call',
        toolName: tc.function.name,
        arguments: tc.function.arguments || {},
        thought: typeof aiResponse.message.content === 'string' ? aiResponse.message.content : undefined,
      };
    }

    const replyText = typeof aiResponse.message.content === 'string' ? aiResponse.message.content.trim() : '';
    if (replyText.length > 0) {
      return {
        type: 'finish',
        finalAnswer: replyText,
      };
    }

    return { type: 'finish' };
  }
}
