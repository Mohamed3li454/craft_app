/**
 * Centralized Token & Context Budget Types (Phase 8.1)
 *
 * Defines strongly-typed models for model context limits, token estimation,
 * priority-based context allocation, and dynamic budget enforcement.
 */

export interface ModelContextProfile {
  readonly modelId: string;
  readonly contextWindowTokens: number;
  readonly outputReserveTokens: number;
  readonly defaultSafetyTokens: number;
}

export interface TokenBudget {
  readonly modelId: string;
  readonly modelContextLimit: number;
  readonly outputReserveTokens: number;
  readonly systemTokens: number;
  readonly userQueryTokens: number;
  readonly mediaTokens: number;
  readonly toolResultTokens: number;
  readonly allocatedMemoryTokens: number;
  readonly allocatedHistoryTokens: number;
  readonly availableTokens: number;
  readonly consumedTokens: number;
}

export interface BudgetAllocationRequest {
  readonly modelId?: string;
  readonly systemInstructionText?: string;
  readonly userQueryText: string;
  readonly mediaText?: string;
  readonly toolResultText?: string;
  readonly candidateMemoryTokens?: number;
  readonly candidateHistoryTurns?: number;
  readonly candidateHistoryChars?: number;
}

export interface BudgetAllocationResult {
  readonly budget: TokenBudget;
  readonly maxMemoryTokens: number;
  readonly maxMemoryChars: number;
  readonly maxHistoryTurns: number;
  readonly maxHistoryChars: number;
  readonly maxToolResultChars: number;
  readonly truncationOccurred: boolean;
  readonly truncationDetails: readonly string[];
}
