/**
 * Execution State Manager (Phase 8.3)
 *
 * Authoritative manager for AgentExecutionState:
 * - State initialization, step transitions, and status updates
 * - Sanitizes arguments and results to guarantee zero sensitive credential leakage in state/logs
 * - Token accumulation and telemetry recording
 */

import { v4 as uuidv4 } from 'uuid';
import { redactSecrets } from '../../tools/contracts/error.types';
import {
  AgentExecutionState,
  AgentExecutionStatus,
  AgentExecutionStep,
  StepStatus,
} from './types';

export class ExecutionStateManager {
  /**
   * Initializes a fresh AgentExecutionState for a conversation turn task.
   */
  public static createInitialState(
    runId: string,
    taskId: string,
    goal: string,
    maxSteps: number
  ): AgentExecutionState {
    return {
      runId,
      taskId,
      status: 'planning',
      currentStep: 0,
      maxSteps,
      goal: (goal || '').trim(),
      steps: [],
      totalToolCalls: 0,
      totalToolExecutionMs: 0,
      startedAt: Date.now(),
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    };
  }

  /**
   * Appends a new execution step to the state, sanitizing inputs.
   */
  public static createStep(
    state: AgentExecutionState,
    toolName: string,
    input: Record<string, any>
  ): AgentExecutionStep {
    const index = state.steps.length + 1;
    const id = `step_${index}_${uuidv4().substring(0, 8)}`;
    const sanitizedInput = this.sanitizeObject(input);

    const step: AgentExecutionStep = {
      id,
      index,
      toolName,
      status: 'pending',
      input: sanitizedInput,
      startedAt: Date.now(),
    };

    state.steps.push(step);
    state.currentStep = index;
    state.status = 'executing';
    return step;
  }

  /**
   * Updates an existing step with execution results, verification, and timing.
   */
  public static completeStep(
    step: AgentExecutionStep,
    status: StepStatus,
    result?: any,
    serializedResult?: string,
    error?: any,
    durationMs?: number
  ): void {
    step.status = status;
    step.completedAt = Date.now();
    step.durationMs = durationMs ?? (step.completedAt - step.startedAt);

    if (result !== undefined) {
      step.result = typeof result === 'object' ? this.sanitizeObject(result) : result;
    }
    if (serializedResult !== undefined) {
      step.serializedResult = redactSecrets(serializedResult);
    }
    if (error) {
      step.error = {
        code: error.code || 'EXECUTION_FAILED',
        message: redactSecrets(error.message || String(error)),
        userSafeMessage: error.userSafeMessage || 'Tool execution encountered an error.',
        retryable: error.retryable ?? false,
      };
    }
  }

  /**
   * Transitions the execution status with optional failure reason.
   */
  public static transitionStatus(
    state: AgentExecutionState,
    newStatus: AgentExecutionStatus,
    reason?: string
  ): void {
    state.status = newStatus;
    if (reason) {
      state.failureReason = redactSecrets(reason);
    }
    if (['completed', 'partially_completed', 'failed', 'cancelled'].includes(newStatus)) {
      state.completedAt = Date.now();
    }
  }

  /**
   * Accumulates model token usage across steps.
   */
  public static recordTokenUsage(
    state: AgentExecutionState,
    promptTokens: number,
    completionTokens: number,
    totalTokens: number
  ): void {
    state.promptTokens += promptTokens;
    state.completionTokens += completionTokens;
    state.totalTokens += totalTokens;
  }

  /**
   * Deeply sanitizes an object by redacting secrets from all string fields.
   */
  public static sanitizeObject<T>(obj: T): T {
    if (!obj || typeof obj !== 'object') {
      return typeof obj === 'string' ? (redactSecrets(obj) as unknown as T) : obj;
    }

    if (Array.isArray(obj)) {
      return obj.map((item) => this.sanitizeObject(item)) as unknown as T;
    }

    const sanitized: Record<string, any> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'string') {
        sanitized[key] = redactSecrets(value);
      } else if (value && typeof value === 'object') {
        sanitized[key] = this.sanitizeObject(value);
      } else {
        sanitized[key] = value;
      }
    }
    return sanitized as T;
  }
}
