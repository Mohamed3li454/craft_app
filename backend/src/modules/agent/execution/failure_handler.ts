/**
 * Failure Handler (Phase 8.3)
 *
 * Deterministically evaluates execution failures, timeouts, and insufficient results:
 * - Directs recovery strategy without allowing uncontrolled infinite retries
 * - Classifies fatal errors (SSRF, unauthenticated, permission denied)
 * - Decides between partial success synthesis vs full failure abort
 */

import { AgentExecutionState, AgentExecutionStep, ExecutionPolicy } from './types';

export type FailureStrategy =
  | 'retry'
  | 'continue_to_next_step'
  | 'abort_to_partial_synthesis'
  | 'abort_to_failure';

export interface FailureResolution {
  readonly strategy: FailureStrategy;
  readonly reason: string;
  readonly canRetry: boolean;
}

export class FailureHandler {
  private static instance: FailureHandler;

  public static getInstance(): FailureHandler {
    if (!FailureHandler.instance) {
      FailureHandler.instance = new FailureHandler();
    }
    return FailureHandler.instance;
  }

  /**
   * Evaluates a failed or insufficient step and determines recovery strategy.
   */
  public handleFailure(
    step: AgentExecutionStep,
    state: AgentExecutionState,
    policy: ExecutionPolicy
  ): FailureResolution {
    const error = step.error;
    const code = error?.code;
    const retryCount = step.retryCount ?? 0;

    // 1. Unrecoverable Security & Policy Denials -> Abort immediately
    if (
      code === 'SSRF_BLOCKED' ||
      code === 'CHANNEL_NOT_ALLOWED' ||
      code === 'UNAUTHENTICATED' ||
      code === 'TOOL_NOT_ALLOWED_FOR_TRIGGER' ||
      code === 'PERMISSION_DENIED'
    ) {
      const hasPriorSuccess = state.steps.some(
        (s) => s.id !== step.id && s.status === 'succeeded'
      );
      return {
        strategy: hasPriorSuccess ? 'abort_to_partial_synthesis' : 'abort_to_failure',
        reason: `Fatal security policy block: ${error?.userSafeMessage || error?.message || code}`,
        canRetry: false,
      };
    }

    // 2. Input Validation Failure -> Do not blindly retry with same args; planner must adapt
    if (code === 'VALIDATION_ERROR') {
      const hasPriorSuccess = state.steps.some(
        (s) => s.id !== step.id && s.status === 'succeeded'
      );
      return {
        strategy: hasPriorSuccess ? 'abort_to_partial_synthesis' : 'continue_to_next_step',
        reason: `Validation error for tool [${step.toolName}]: ${error?.userSafeMessage || error?.message}`,
        canRetry: false,
      };
    }

    // 3. Transient Network or Timeout Error -> Allow at most 1 single retry if within budget
    const isTransient = code === 'TIMEOUT_ERROR' || code === 'NETWORK_ERROR' || error?.retryable;
    const timeRemainingMs = policy.maxExecutionMs - (Date.now() - state.startedAt);

    if (isTransient && retryCount === 0 && timeRemainingMs > 4000) {
      return {
        strategy: 'retry',
        reason: `Transient error for tool [${step.toolName}]. Retrying once within budget.`,
        canRetry: true,
      };
    }

    // 4. Insufficient result (e.g. 0 results from search) -> Continue so planner can decide next step or answer
    if (step.verification?.status === 'insufficient') {
      return {
        strategy: 'continue_to_next_step',
        reason: `Tool [${step.toolName}] succeeded technically but produced 0 results.`,
        canRetry: false,
      };
    }

    // 5. Default Fallback
    const hasPriorSuccess = state.steps.some(
      (s) => s.id !== step.id && s.status === 'succeeded'
    );
    return {
      strategy: hasPriorSuccess ? 'abort_to_partial_synthesis' : 'abort_to_failure',
      reason: error?.userSafeMessage || error?.message || 'Tool execution failed',
      canRetry: false,
    };
  }
}
