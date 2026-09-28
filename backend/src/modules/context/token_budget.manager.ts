/**
 * Centralized Token Budget Manager (Phase 8.1)
 *
 * Implements deterministic priority-based context allocation:
 * 1. System Safety & Core Instructions (Non-negotiable)
 * 2. Current User Input & Media Attachments (Highest runtime priority)
 * 3. Required Tool Results (Execution fidelity)
 * 4. Relevant Active Memory (Personalization & continuity)
 * 5. Relevant Conversation History (Multi-turn coherence)
 * 6. Optional Context & Supplemental Prompts
 */

import {
  BudgetAllocationRequest,
  BudgetAllocationResult,
  ModelContextProfile,
  TokenBudget,
} from './token_budget.types';
import { TokenCounter } from './token_counter';
import { getModelProfile } from './model_profiles';

export class TokenBudgetManager {
  private static instance: TokenBudgetManager;

  public static getInstance(): TokenBudgetManager {
    if (!TokenBudgetManager.instance) {
      TokenBudgetManager.instance = new TokenBudgetManager();
    }
    return TokenBudgetManager.instance;
  }

  /**
   * Allocates available context tokens across competing concerns according to strict priority order.
   */
  public allocate(request: BudgetAllocationRequest): BudgetAllocationResult {
    const profile: ModelContextProfile = getModelProfile(request.modelId);
    const truncationDetails: string[] = [];

    const totalWindow = profile.contextWindowTokens;
    const outputReserve = profile.outputReserveTokens;
    const safetyReserve = profile.defaultSafetyTokens;

    // Available ceiling for all prompt contents
    const totalUsableInputTokens = Math.max(0, totalWindow - outputReserve - safetyReserve);

    // 1. System instructions
    const systemTokens = TokenCounter.countTokens(request.systemInstructionText || '');

    // 2. User query & media
    const userQueryTokens = TokenCounter.countTokens(request.userQueryText || '');
    const mediaTokens = TokenCounter.countTokens(request.mediaText || '');

    // 3. Tool results (if any)
    const rawToolTokens = TokenCounter.countTokens(request.toolResultText || '');
    // Tool result cap: cannot exceed 50% of total usable tokens to prevent starving system/user/history
    const toolResultTokenCap = Math.max(1024, Math.floor(totalUsableInputTokens * 0.5));
    const toolResultTokens = Math.min(rawToolTokens, toolResultTokenCap);

    if (rawToolTokens > toolResultTokenCap) {
      truncationDetails.push(
        `Tool results truncated: requested ${rawToolTokens} tokens, capped to ${toolResultTokenCap}`
      );
    }

    const baselineConsumed = systemTokens + userQueryTokens + mediaTokens + toolResultTokens;
    let remainingTokens = Math.max(0, totalUsableInputTokens - baselineConsumed);

    if (baselineConsumed > totalUsableInputTokens) {
      truncationDetails.push(
        `Baseline inputs exceed usable context window (${baselineConsumed} > ${totalUsableInputTokens})`
      );
    }

    // 4. Memory tokens (Priority 4)
    // Memory can claim up to requested tokens or up to min(remaining, 2048)
    const requestedMemoryTokens = request.candidateMemoryTokens || 0;
    const maxMemoryAllowed = Math.min(requestedMemoryTokens, remainingTokens, 2048);
    const allocatedMemoryTokens = Math.max(0, maxMemoryAllowed);

    if (requestedMemoryTokens > allocatedMemoryTokens) {
      truncationDetails.push(
        `Memory truncated: requested ${requestedMemoryTokens} tokens, allocated ${allocatedMemoryTokens}`
      );
    }

    remainingTokens = Math.max(0, remainingTokens - allocatedMemoryTokens);

    // 5. History tokens (Priority 5)
    // Whatever is left in remainingTokens goes to conversation history
    const allocatedHistoryTokens = remainingTokens;
    const hasArabic =
      TokenCounter.hasArabicScript(request.userQueryText) ||
      TokenCounter.hasArabicScript(request.systemInstructionText);

    const maxHistoryChars = TokenCounter.estimateCharLimit(allocatedHistoryTokens, hasArabic);
    const maxMemoryChars = TokenCounter.estimateCharLimit(allocatedMemoryTokens, hasArabic);
    const maxToolResultChars = TokenCounter.estimateCharLimit(toolResultTokens, hasArabic);

    // Default max turns: up to 8 turns standard, or fewer if token budget is severely constrained
    const calculatedMaxTurns = Math.max(
      1,
      Math.min(request.candidateHistoryTurns || 8, Math.floor(allocatedHistoryTokens / 120))
    );

    if (
      request.candidateHistoryChars &&
      request.candidateHistoryChars > maxHistoryChars
    ) {
      truncationDetails.push(
        `History truncated: requested ${request.candidateHistoryChars} chars, budget allowed ${maxHistoryChars} chars`
      );
    }

    const consumedTokens =
      systemTokens +
      userQueryTokens +
      mediaTokens +
      toolResultTokens +
      allocatedMemoryTokens +
      allocatedHistoryTokens;

    const budget: TokenBudget = {
      modelId: profile.modelId,
      modelContextLimit: totalWindow,
      outputReserveTokens: outputReserve,
      systemTokens,
      userQueryTokens,
      mediaTokens,
      toolResultTokens,
      allocatedMemoryTokens,
      allocatedHistoryTokens,
      availableTokens: totalUsableInputTokens,
      consumedTokens,
    };

    return {
      budget,
      maxMemoryTokens: allocatedMemoryTokens,
      maxMemoryChars,
      maxHistoryTurns: calculatedMaxTurns,
      maxHistoryChars,
      maxToolResultChars,
      truncationOccurred: truncationDetails.length > 0,
      truncationDetails,
    };
  }

  /**
   * Deterministically truncates message history according to turns and character limits,
   * keeping the most recent messages intact.
   */
  public truncateHistory<T extends { role?: string; senderRole?: string; text?: string; content?: string }>(
    messages: readonly T[],
    maxTurns: number,
    maxChars: number
  ): T[] {
    if (!messages || messages.length === 0) return [];

    // Slice to max turns from the end
    const recent = messages.slice(-maxTurns);
    const result: T[] = [];
    let accumulatedChars = 0;

    // Walk backwards from newest to oldest
    for (let i = recent.length - 1; i >= 0; i--) {
      const msg = recent[i];
      const text = msg.content ?? msg.text ?? '';
      const msgLen = text.length;

      if (accumulatedChars + msgLen <= maxChars || result.length === 0) {
        result.unshift(msg);
        accumulatedChars += msgLen;
      } else {
        // Exceeded char allowance, stop adding older turns
        break;
      }
    }

    return result;
  }
}
