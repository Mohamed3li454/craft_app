/**
 * Step Verifier (Phase 8.3)
 *
 * Enforces deterministic post-execution verification on tool results:
 * Distinguishes between:
 * - 'success': Tool executed and returned meaningful task data
 * - 'insufficient': Tool executed successfully, but returned empty data (e.g. 0 search results)
 * - 'partial': Tool output truncated or requires subsequent user confirmation
 * - 'failure': Tool threw an error, was rejected, or returned structural failure
 */

import { LifecycleExecutionResult } from '../../tools/lifecycle/tool_lifecycle';
import { StepVerification } from './types';

export class StepVerifier {
  private static instance: StepVerifier;

  public static getInstance(): StepVerifier {
    if (!StepVerifier.instance) {
      StepVerifier.instance = new StepVerifier();
    }
    return StepVerifier.instance;
  }

  /**
   * Deterministically verifies the execution result of a tool step.
   */
  public verify(
    toolName: string,
    lifecycleResult: LifecycleExecutionResult
  ): StepVerification {
    // 1. Failure / Denial
    if (lifecycleResult.status === 'failed' || lifecycleResult.status === 'denied') {
      return {
        status: 'failure',
        structuralSuccess: false,
        hasUsableData: false,
        reason: lifecycleResult.error?.message || 'Tool execution unsuccessful',
        details: { code: lifecycleResult.error?.code },
      };
    }

    // 2. Sensitive Action Confirmation Required
    if (lifecycleResult.status === 'confirmation_required') {
      return {
        status: 'partial',
        structuralSuccess: true,
        hasUsableData: true,
        reason: 'Sensitive operation requires explicit confirmation before mutation',
      };
    }

    // 3. Completed: Inspect tool-specific structure and data presence
    const output = lifecycleResult.rawResult;

    if (toolName === 'web_search') {
      const results = output?.results;
      if (Array.isArray(results) && results.length === 0) {
        return {
          status: 'insufficient',
          structuralSuccess: true,
          hasUsableData: false,
          dataCount: 0,
          reason: 'Web search returned 0 matching results',
        };
      }
      return {
        status: 'success',
        structuralSuccess: true,
        hasUsableData: true,
        dataCount: Array.isArray(results) ? results.length : 1,
      };
    }

    if (toolName === 'get_weather') {
      const hasTemp = output?.temperatureC !== undefined;
      const hasCity = !!output?.city;
      if (!hasTemp || !hasCity) {
        return {
          status: 'partial',
          structuralSuccess: true,
          hasUsableData: false,
          reason: 'Weather result missing temperature or location data',
        };
      }
      return {
        status: 'success',
        structuralSuccess: true,
        hasUsableData: true,
      };
    }

    if (toolName === 'get_current_time') {
      const hasIso = !!output?.iso;
      return {
        status: hasIso ? 'success' : 'failure',
        structuralSuccess: hasIso,
        hasUsableData: hasIso,
        reason: hasIso ? undefined : 'Current time returned without ISO timestamp',
      };
    }

    if (toolName === 'complete_reminder') {
      const completed = output?.status === 'completed';
      return {
        status: completed ? 'success' : 'failure',
        structuralSuccess: completed,
        hasUsableData: completed,
        reason: completed ? undefined : 'Failed to mark reminder as completed',
      };
    }

    if (toolName === 'list_reminders') {
      const count = output?.count ?? 0;
      return {
        status: 'success',
        structuralSuccess: true,
        hasUsableData: true,
        dataCount: count,
      };
    }

    // Generic Tool Verification
    if (output === null || output === undefined) {
      return {
        status: 'insufficient',
        structuralSuccess: true,
        hasUsableData: false,
        reason: 'Tool execution produced empty null output',
      };
    }

    return {
      status: 'success',
      structuralSuccess: true,
      hasUsableData: true,
    };
  }
}
