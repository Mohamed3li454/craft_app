/**
 * Execution Policy Manager (Phase 8.3)
 *
 * Enforces hard bounded execution ceilings and evaluates budget thresholds:
 * - Default: MAX_STEPS_PER_TURN = 3
 * - Absolute Hard Limits: MAX_HARD_STEPS = 5, MAX_HARD_TOOL_CALLS = 5
 * - Turn timeout: 30,000ms (clamped to 45,000ms max)
 * - Safe clamping prevents misconfiguration or runaway execution loops
 */

import { AgentExecutionState, ExecutionPolicy } from './types';

export const HARD_LIMITS = {
  MAX_STEPS: 5,
  MAX_TOOL_CALLS: 5,
  MAX_EXECUTION_MS: 45000,
  MAX_TOTAL_OUTPUT_CHARS: 30000,
} as const;

export const DEFAULT_EXECUTION_POLICY: ExecutionPolicy = {
  maxSteps: 3,
  maxToolCalls: 3,
  maxExecutionMs: 30000,
  maxTotalToolOutputChars: 12000,
  hardMaxSteps: HARD_LIMITS.MAX_STEPS,
  hardMaxToolCalls: HARD_LIMITS.MAX_TOOL_CALLS,
  hardMaxExecutionMs: HARD_LIMITS.MAX_EXECUTION_MS,
  allowParallel: false, // Phase 8.3 is strictly sequential
};

export class ExecutionPolicyManager {
  private static instance: ExecutionPolicyManager;

  public static getInstance(): ExecutionPolicyManager {
    if (!ExecutionPolicyManager.instance) {
      ExecutionPolicyManager.instance = new ExecutionPolicyManager();
    }
    return ExecutionPolicyManager.instance;
  }

  /**
   * Resolves execution policy by merging overrides and strictly clamping to hard limits.
   */
  public resolvePolicy(overrides?: Partial<ExecutionPolicy>): ExecutionPolicy {
    const requestedSteps = overrides?.maxSteps ?? DEFAULT_EXECUTION_POLICY.maxSteps;
    const requestedToolCalls = overrides?.maxToolCalls ?? DEFAULT_EXECUTION_POLICY.maxToolCalls;
    const requestedTimeout = overrides?.maxExecutionMs ?? DEFAULT_EXECUTION_POLICY.maxExecutionMs;
    const requestedOutputChars =
      overrides?.maxTotalToolOutputChars ?? DEFAULT_EXECUTION_POLICY.maxTotalToolOutputChars;

    return {
      maxSteps: Math.min(Math.max(1, requestedSteps), HARD_LIMITS.MAX_STEPS),
      maxToolCalls: Math.min(Math.max(1, requestedToolCalls), HARD_LIMITS.MAX_TOOL_CALLS),
      maxExecutionMs: Math.min(Math.max(1000, requestedTimeout), HARD_LIMITS.MAX_EXECUTION_MS),
      maxTotalToolOutputChars: Math.min(
        Math.max(500, requestedOutputChars),
        HARD_LIMITS.MAX_TOTAL_OUTPUT_CHARS
      ),
      hardMaxSteps: HARD_LIMITS.MAX_STEPS,
      hardMaxToolCalls: HARD_LIMITS.MAX_TOOL_CALLS,
      hardMaxExecutionMs: HARD_LIMITS.MAX_EXECUTION_MS,
      allowParallel: false,
    };
  }

  /**
   * Evaluates if the current execution state remains strictly within budget.
   */
  public checkBudget(
    state: AgentExecutionState,
    policy: ExecutionPolicy,
    startTime: number
  ): { withinBudget: boolean; reason?: string } {
    // 1. Step count check
    if (state.currentStep >= policy.maxSteps) {
      return {
        withinBudget: false,
        reason: `Exceeded maximum allowed steps (${state.currentStep}/${policy.maxSteps})`,
      };
    }

    // 2. Tool calls count check
    if (state.totalToolCalls >= policy.maxToolCalls) {
      return {
        withinBudget: false,
        reason: `Exceeded maximum allowed tool calls (${state.totalToolCalls}/${policy.maxToolCalls})`,
      };
    }

    // 3. Execution time check
    const elapsedMs = Date.now() - startTime;
    if (elapsedMs >= policy.maxExecutionMs) {
      return {
        withinBudget: false,
        reason: `Execution timeout exceeded (${elapsedMs}ms >= ${policy.maxExecutionMs}ms)`,
      };
    }

    // 4. Cumulative tool output character limit
    const cumulativeChars = state.steps.reduce(
      (acc, s) => acc + (s.serializedResult ? s.serializedResult.length : 0),
      0
    );
    if (cumulativeChars >= policy.maxTotalToolOutputChars) {
      return {
        withinBudget: false,
        reason: `Total tool output character budget exhausted (${cumulativeChars}/${policy.maxTotalToolOutputChars} chars)`,
      };
    }

    return { withinBudget: true };
  }
}
