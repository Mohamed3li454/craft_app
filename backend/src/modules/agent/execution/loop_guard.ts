/**
 * Loop Guard & Idempotency Engine (Phase 8.3)
 *
 * Prevents execution deadlocks, oscillations, and runaway tool calls:
 * - Detects exact duplicates using canonical parameter fingerprints
 * - Detects multi-step cycle oscillations (e.g. A -> B -> A -> B)
 * - Distinguishes duplicate calls from legitimate progressive refinements
 * - Enforces mutation idempotency (blocks duplicate reminder creations/completions in a single turn)
 */

import crypto from 'crypto';

export interface LoopCheckDecision {
  readonly allowed: boolean;
  readonly reason?: string;
  readonly isLoop: boolean;
  readonly isOscillation: boolean;
  readonly isIdempotencyViolation: boolean;
}

export class LoopGuard {
  private executedFingerprints: string[] = [];
  private executedToolNames: string[] = [];
  private executedMutations: Map<string, Set<string>> = new Map();

  /**
   * Resets internal state for a new execution turn.
   */
  public reset(): void {
    this.executedFingerprints = [];
    this.executedToolNames = [];
    this.executedMutations.clear();
  }

  /**
   * Generates a deterministic canonical fingerprint for a tool call.
   */
  public computeFingerprint(toolName: string, args: Record<string, any>): string {
    const canonicalJson = this.canonicalizeJson(args);
    return `${toolName}:${crypto.createHash('sha256').update(canonicalJson).digest('hex').substring(0, 16)}`;
  }

  /**
   * Evaluates if a proposed tool call is permissible or would cause a loop/idempotency violation.
   */
  public check(toolName: string, rawArgs: Record<string, any>): LoopCheckDecision {
    const args = rawArgs || {};
    const fingerprint = this.computeFingerprint(toolName, args);

    // 1. Mutation & Sensitive Idempotency Check
    const isMutation =
      ['create_reminder', 'complete_reminder', 'save_memory'].includes(toolName);

    if (isMutation) {
      const mutationKey = this.extractMutationKey(toolName, args);
      const previousKeys = this.executedMutations.get(toolName);
      if (previousKeys && previousKeys.has(mutationKey)) {
        return {
          allowed: false,
          reason: `Idempotency violation: [${toolName}] mutation was already executed for this entity in this turn.`,
          isLoop: false,
          isOscillation: false,
          isIdempotencyViolation: true,
        };
      }
    }

    // 2. Exact Duplicate Tool Call Check
    if (this.executedFingerprints.includes(fingerprint)) {
      return {
        allowed: false,
        reason: `Duplicate tool call detected: [${toolName}] was already executed with identical arguments in this turn.`,
        isLoop: true,
        isOscillation: false,
        isIdempotencyViolation: isMutation,
      };
    }

    // 3. Search Query Saturation Check
    if (toolName === 'web_search') {
      const searchCount = this.executedToolNames.filter((t) => t === 'web_search').length;
      if (searchCount >= 2) {
        return {
          allowed: false,
          reason: `Web search limit reached (maximum 2 search queries per turn). Proceed to final synthesis.`,
          isLoop: true,
          isOscillation: false,
          isIdempotencyViolation: false,
        };
      }
    }

    // 4. Oscillation Detection (e.g. A -> B -> A -> B)
    const proposedHistory = [...this.executedToolNames, toolName];
    if (this.detectOscillation(proposedHistory)) {
      return {
        allowed: false,
        reason: `Oscillation cycle detected between tools: ${proposedHistory.join(' -> ')}. Halting loop.`,
        isLoop: false,
        isOscillation: true,
        isIdempotencyViolation: false,
      };
    }

    return {
      allowed: true,
      isLoop: false,
      isOscillation: false,
      isIdempotencyViolation: false,
    };
  }

  /**
   * Records a successfully initiated tool call into tracking history.
   */
  public record(toolName: string, rawArgs: Record<string, any>): void {
    const args = rawArgs || {};
    const fingerprint = this.computeFingerprint(toolName, args);
    this.executedFingerprints.push(fingerprint);
    this.executedToolNames.push(toolName);

    const isMutation =
      ['create_reminder', 'complete_reminder', 'save_memory'].includes(toolName);
    if (isMutation) {
      const mutationKey = this.extractMutationKey(toolName, args);
      if (!this.executedMutations.has(toolName)) {
        this.executedMutations.set(toolName, new Set());
      }
      this.executedMutations.get(toolName)!.add(mutationKey);
    }
  }

  /**
   * Detects 2-step repetitive oscillation patterns like [A, B, A, B].
   */
  private detectOscillation(toolNames: string[]): boolean {
    if (toolNames.length < 4) return false;
    const len = toolNames.length;
    // Check 2-cycle: [len-4] == [len-2] and [len-3] == [len-1]
    return (
      toolNames[len - 4] === toolNames[len - 2] &&
      toolNames[len - 3] === toolNames[len - 1] &&
      toolNames[len - 2] !== toolNames[len - 1]
    );
  }

  /**
   * Extracts a normalized entity key for idempotency evaluation.
   */
  private extractMutationKey(toolName: string, args: Record<string, any>): string {
    if (toolName === 'create_reminder' || toolName === 'complete_reminder') {
      return (args.title || '').trim().toLowerCase();
    }
    if (toolName === 'save_memory') {
      return (args.factText || '').trim().toLowerCase();
    }
    return JSON.stringify(args);
  }

  /**
   * Serializes an object deterministically with sorted keys.
   */
  private canonicalizeJson(obj: any): string {
    if (obj === null || typeof obj !== 'object') {
      return JSON.stringify(obj);
    }
    if (Array.isArray(obj)) {
      return `[${obj.map((x) => this.canonicalizeJson(x)).join(',')}]`;
    }
    const sortedKeys = Object.keys(obj).sort();
    const pairs = sortedKeys.map(
      (k) => `${JSON.stringify(k)}:${this.canonicalizeJson(obj[k])}`
    );
    return `{${pairs.join(',')}}`;
  }
}
