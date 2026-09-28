/**
 * Agent Execution Intelligence Types (Phase 8.3)
 *
 * Defines contracts, state representations, step lifecycle,
 * verification taxonomy, and bounded policies for multi-step agent execution.
 */

import { ToolError } from '../../tools/contracts/error.types';
import { LanguageContext } from '../../language/types';
import { PersonalityContext } from '../../personality/types';
import { PersonalizationPolicy } from '../../personalization/types';
import { AdaptiveResponsePolicy } from '../../response/types';
import { ProactivePolicy } from '../../proactive/types';
import { BudgetAllocationResult } from '../../context';

export type AgentExecutionStatus =
  | 'planning'
  | 'executing'
  | 'waiting_confirmation'
  | 'verifying'
  | 'completed'
  | 'partially_completed'
  | 'failed'
  | 'cancelled';

export type StepStatus =
  | 'pending'
  | 'running'
  | 'waiting_confirmation'
  | 'succeeded'
  | 'partial'
  | 'failed'
  | 'skipped'
  | 'cancelled';

export type VerificationStatus =
  | 'success'
  | 'partial'
  | 'failure'
  | 'insufficient';

export interface StepVerification {
  readonly status: VerificationStatus;
  readonly reason?: string;
  readonly structuralSuccess: boolean;
  readonly hasUsableData: boolean;
  readonly dataCount?: number;
  readonly details?: Record<string, unknown>;
}

export interface AgentExecutionStep {
  readonly id: string;
  readonly index: number;
  readonly toolName: string;
  status: StepStatus;
  readonly input: Record<string, any>;
  result?: any;
  serializedResult?: string;
  error?: ToolError;
  readonly startedAt: number;
  completedAt?: number;
  durationMs?: number;
  retryable?: boolean;
  retryCount?: number;
  verification?: StepVerification;
}

export type ExecutionDecision =
  | {
      readonly type: 'tool_call';
      readonly toolName: string;
      readonly arguments: Record<string, any>;
      readonly thought?: string;
    }
  | {
      readonly type: 'finish';
      readonly finalAnswer?: string;
    }
  | {
      readonly type: 'clarify';
      readonly question: string;
    }
  | {
      readonly type: 'wait_confirmation';
      readonly toolName: string;
      readonly arguments: Record<string, any>;
      readonly confirmationToken?: string;
    }
  | {
      readonly type: 'fail';
      readonly reason: string;
    };

export interface ExecutionPolicy {
  readonly maxSteps: number;
  readonly maxToolCalls: number;
  readonly maxExecutionMs: number;
  readonly maxTotalToolOutputChars: number;
  readonly hardMaxSteps: number;
  readonly hardMaxToolCalls: number;
  readonly hardMaxExecutionMs: number;
  readonly allowParallel: boolean;
}

export interface AgentExecutionState {
  readonly runId: string;
  readonly taskId: string;
  status: AgentExecutionStatus;
  currentStep: number;
  readonly maxSteps: number;
  readonly goal: string;
  readonly steps: AgentExecutionStep[];
  totalToolCalls: number;
  totalToolExecutionMs: number;
  readonly startedAt: number;
  completedAt?: number;
  failureReason?: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  metadata?: Record<string, unknown>;
}

export interface ExecutionEngineContext {
  readonly runId: string;
  readonly userId: string;
  readonly conversationId: string;
  readonly channel: 'flutter' | 'whatsapp';
  readonly userGoal: string;
  readonly languageContext?: LanguageContext;
  readonly personalityContext?: PersonalityContext;
  readonly personalizationPolicy?: PersonalizationPolicy;
  readonly adaptiveResponsePolicy?: AdaptiveResponsePolicy;
  readonly proactivePolicy?: ProactivePolicy;
  readonly tokenBudgetResult?: BudgetAllocationResult;
  readonly abortSignal?: AbortSignal;
  readonly policy?: Partial<ExecutionPolicy>;
  readonly sendInterim?: (msg: string) => Promise<void>;
  readonly memories?: string[];
  readonly imageAttachment?: { data: string; mimeType: string };
}

export interface ExecutionEngineRunResult {
  readonly status: AgentExecutionStatus;
  readonly finalReply: string;
  readonly state: AgentExecutionState;
  readonly steps: AgentExecutionStep[];
  readonly toolCallsExecuted: Array<{
    toolName: string;
    arguments: Record<string, any>;
    result: any;
  }>;
  readonly confirmationRequest?: {
    token: string;
    actionName: string;
    description: string;
    expiresAt: string;
  };
  readonly metrics: {
    readonly stepsExecuted: number;
    readonly totalToolCalls: number;
    readonly totalDurationMs: number;
    readonly engineOverheadMs: number;
    readonly promptTokens: number;
    readonly completionTokens: number;
    readonly totalTokens: number;
  };
}
