/**
 * Deterministic Structural Evaluation Assertions (Phase 8.5)
 *
 * Implements strict behavioral and architectural checks without relying on
 * nondeterministic LLM judges.
 */

export interface AssertionCheckResult {
  ok: boolean;
  message?: string;
}

export class EvaluationAssertions {
  /**
   * Asserts that a specific tool was invoked during execution.
   */
  public static assertToolUsed(actual: Record<string, unknown>, toolName: string): AssertionCheckResult {
    const executedTools: string[] = (actual.toolCalls as string[]) || [];
    const used = executedTools.includes(toolName);
    return {
      ok: used,
      message: used ? undefined : `Expected tool [${toolName}] to be used, but got [${executedTools.join(', ')}]`,
    };
  }

  /**
   * Asserts that a specific tool was NOT invoked during execution.
   */
  public static assertToolNotUsed(actual: Record<string, unknown>, toolName: string): AssertionCheckResult {
    const executedTools: string[] = (actual.toolCalls as string[]) || [];
    const used = executedTools.includes(toolName);
    return {
      ok: !used,
      message: !used ? undefined : `Expected tool [${toolName}] NOT to be used, but it was executed`,
    };
  }

  /**
   * Asserts the conversational or adaptive strategy selected.
   */
  public static assertStrategy(actual: Record<string, unknown>, expectedStrategy: string): AssertionCheckResult {
    const strategy = actual.strategy || actual.responseStrategy;
    const ok = strategy === expectedStrategy;
    return {
      ok,
      message: ok ? undefined : `Expected strategy [${expectedStrategy}], but got [${strategy}]`,
    };
  }

  /**
   * Asserts the AI provider utilized.
   */
  public static assertProvider(actual: Record<string, unknown>, expectedProvider: string): AssertionCheckResult {
    const provider = actual.provider || actual.lastProviderUsed;
    const ok = provider === expectedProvider;
    return {
      ok,
      message: ok ? undefined : `Expected provider [${expectedProvider}], but got [${provider}]`,
    };
  }

  /**
   * Asserts whether provider fallback occurred.
   */
  public static assertFallback(actual: Record<string, unknown>, expectedFallback: boolean): AssertionCheckResult {
    const fallback = Boolean(actual.fallbackUsed || actual.isFallback);
    const ok = fallback === expectedFallback;
    return {
      ok,
      message: ok ? undefined : `Expected fallbackUsed to be [${expectedFallback}], but got [${fallback}]`,
    };
  }

  /**
   * Asserts that memory was retrieved and selected into context.
   */
  public static assertMemorySelected(actual: Record<string, unknown>, minCount = 1): AssertionCheckResult {
    const count = Number(actual.memorySelectedCount ?? (actual.memories ? (actual.memories as any[]).length : 0));
    const ok = count >= minCount;
    return {
      ok,
      message: ok ? undefined : `Expected at least ${minCount} memories selected, but got ${count}`,
    };
  }

  /**
   * Asserts that no memories were selected into context.
   */
  public static assertMemoryNotSelected(actual: Record<string, unknown>): AssertionCheckResult {
    const count = Number(actual.memorySelectedCount ?? (actual.memories ? (actual.memories as any[]).length : 0));
    const ok = count === 0;
    return {
      ok,
      message: ok ? undefined : `Expected 0 memories selected, but got ${count}`,
    };
  }

  /**
   * Asserts whether a clarification was prompted to user.
   */
  public static assertClarification(actual: Record<string, unknown>, expectedBool: boolean): AssertionCheckResult {
    const clarification = Boolean(actual.clarificationNeeded || actual.strategy === 'clarification_prompt');
    const ok = clarification === expectedBool;
    return {
      ok,
      message: ok ? undefined : `Expected clarification to be [${expectedBool}], but got [${clarification}]`,
    };
  }

  /**
   * Asserts execution steps bounded within maximum threshold.
   */
  public static assertExecutionSteps(actual: Record<string, unknown>, maxSteps?: number): AssertionCheckResult {
    const steps = Number(actual.stepsCount ?? (actual.steps ? (actual.steps as any[]).length : 0));
    if (maxSteps === undefined) return { ok: true };
    const ok = steps <= maxSteps;
    return {
      ok,
      message: ok ? undefined : `Expected steps count <= ${maxSteps}, but took ${steps} steps`,
    };
  }

  /**
   * Asserts the final execution status.
   */
  public static assertFinalState(actual: Record<string, unknown>, expectedStatus: string): AssertionCheckResult {
    const status = actual.status;
    const ok = status === expectedStatus;
    return {
      ok,
      message: ok ? undefined : `Expected status [${expectedStatus}], but got [${status}]`,
    };
  }

  /**
   * Asserts that a safety boundary was triggered (e.g. suppression reason, confirmation required).
   */
  public static assertSafetyBoundary(actual: Record<string, unknown>, expectedReason?: string): AssertionCheckResult {
    const blockedReason = actual.blockedReason || actual.suppressionReason || actual.status;
    if (!expectedReason) {
      const ok = Boolean(blockedReason);
      return { ok, message: ok ? undefined : 'Expected a safety boundary to be triggered, but none was recorded' };
    }
    const ok = String(blockedReason).toLowerCase().includes(expectedReason.toLowerCase());
    return {
      ok,
      message: ok ? undefined : `Expected safety boundary [${expectedReason}], but got [${blockedReason}]`,
    };
  }
}
