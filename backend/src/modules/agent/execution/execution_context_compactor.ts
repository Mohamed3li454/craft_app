/**
 * Execution Context Compactor (Phase 14.6)
 *
 * Implements deterministic multi-call context compaction and cross-step
 * evidence deduplication for multi-step agent executions:
 *
 * 1. Cross-Step Search Deduplication:
 *    - Deduplicates search results across multiple planner iterations using canonical source keys.
 *    - Invariant: Different articles from the same domain are NEVER deduplicated.
 *    - Invariant: Conflicting viewpoints, dates, and prices across distinct sources are 100% preserved.
 *
 * 2. Crawler Boilerplate Stripping:
 *    - Cleans snippets using SearchEvidenceCompactor.cleanSnippetBoilerplate.
 *    - Preserves all verified numbers, dates, prices, and facts.
 *
 * 3. Error Sanitization:
 *    - Strips internal runtime stack traces, database schema logs, and sensitive tokens.
 *    - Preserves user-safe failure reasons and error categories.
 *
 * 4. Dense Observation Generation:
 *    - Replaces repetitive, sprawling JSON trees with structured, high-density observations
 *      for both intermediate planner turns and final synthesis prompt injection.
 */

import { AIMessage } from '../../ai';
import { redactSecrets } from '../../tools/contracts/error.types';
import { SearchEvidenceCompactor } from '../../tools/search/search_evidence_compactor';
import { SearchPresentationPolicy } from '../../tools/search/search_presentation_policy';
import { AgentExecutionStep } from './types';

export interface ToolObservation {
  readonly stepId: string;
  readonly toolName: string;
  readonly status: 'succeeded' | 'failed' | 'partial';
  readonly summary: string;
  readonly verifiedFacts?: readonly string[];
  readonly structuredData?: any;
  readonly errorReason?: string;
}

export interface ExecutionContextSnapshot {
  readonly compactedObservations: readonly ToolObservation[];
  readonly deduplicatedEvidence?: readonly any[];
  readonly estimatedTokensSaved: number;
}

export interface SearchResultItemLike {
  title?: string;
  snippet?: string;
  url?: string;
  sourceDomain?: string;
  sourceName?: string;
  publishedAt?: string;
  publishedTimestamp?: number;
  [key: string]: any;
}

export class ExecutionContextCompactor {
  /**
   * Helper to safely extract search result items from a step's result or serializedResult.
   */
  public static extractSearchItems(step: AgentExecutionStep): SearchResultItemLike[] {
    if (!step) return [];

    let data = step.result;

    if (!data && step.serializedResult) {
      try {
        data = JSON.parse(step.serializedResult);
      } catch {
        return [];
      }
    }

    if (Array.isArray(data)) {
      return data;
    }

    if (data && typeof data === 'object') {
      if (Array.isArray(data.results)) {
        return data.results;
      }
      if (Array.isArray(data.items)) {
        return data.items;
      }
    }

    return [];
  }

  /**
   * Deduplicates a list of search items across multi-step invocations using canonical source keys.
   * Guarantees distinct articles from the same domain or contradictory facts are NEVER dropped.
   */
  public static deduplicateSearchResults<T extends SearchResultItemLike>(
    items: T[],
    existingKeys = new Set<string>()
  ): { deduped: T[]; duplicatesRemoved: number } {
    const deduped: T[] = [];
    let duplicatesRemoved = 0;

    for (const item of items) {
      if (!item) continue;
      const key = SearchEvidenceCompactor.computeSourceKey(item.url, item.title, item.sourceDomain);
      if (existingKeys.has(key)) {
        duplicatesRemoved++;
        continue;
      }

      existingKeys.add(key);

      const cleanedSnippet = SearchEvidenceCompactor.cleanSnippetBoilerplate(item.snippet || '');
      const normalizedUrl = item.url ? SearchEvidenceCompactor.normalizeUrl(item.url) : item.url;

      deduped.push({
        ...item,
        snippet: cleanedSnippet || item.snippet || '',
        url: normalizedUrl,
      });
    }

    return { deduped, duplicatesRemoved };
  }

  /**
   * Compacts prior execution steps into normalized AIMessage history for ExecutionPlanner.
   * Avoids repeating massive JSON trees across sequential planner turns.
   */
  public static compactPlannerMessages(steps: AgentExecutionStep[]): AIMessage[] {
    const messages: AIMessage[] = [];
    const seenSearchKeys = new Set<string>();

    for (const step of steps) {
      // 1. Assistant tool invocation turn
      const isFailedWithoutInput = step.status === 'failed' && (!step.input || Object.keys(step.input).length === 0);
      messages.push({
        role: 'assistant',
        content: isFailedWithoutInput
          ? `Called tool: ${step.toolName}`
          : `Called tool: ${step.toolName} with parameters: ${JSON.stringify(step.input || {})}`,
      });

      // 2. User observation turn
      if (step.status === 'succeeded' || step.status === 'partial') {
        if (step.toolName === 'web_search') {
          const rawItems = this.extractSearchItems(step);
          if (rawItems.length > 0) {
            const { deduped } = this.deduplicateSearchResults(rawItems, seenSearchKeys);
            const lines: string[] = [];
            lines.push(`[Observation for tool "web_search"]:`);
            lines.push(`Found ${deduped.length} verified source(s):`);

            for (const item of deduped.slice(0, 6)) {
              const sourceRef = item.url || item.sourceDomain || 'web';
              lines.push(`- [${item.title || 'Untitled'}] (${sourceRef}): ${item.snippet}`);
            }

            messages.push({
              role: 'user',
              content: redactSecrets(lines.join('\n')),
            });
            continue;
          }
        }

        // Standard tool outcome
        const outcomeText =
          step.serializedResult ||
          (typeof step.result === 'object' ? JSON.stringify(step.result) : String(step.result || 'Success'));

        messages.push({
          role: 'user',
          content: `[Observation for tool "${step.toolName}"]:\n${redactSecrets(outcomeText)}`,
        });
      } else if (step.status === 'failed') {
        const userSafeReason = step.error?.userSafeMessage || step.error?.message || 'Execution failed';
        messages.push({
          role: 'user',
          content: `[Tool Error for "${step.toolName}"]: ${redactSecrets(
            userSafeReason
          )}. Please decide if an alternative step is required or finish with explanation.`,
        });
      }
    }

    return messages;
  }

  /**
   * Formats consolidated execution outcomes for final response synthesis in ExecutionEngine.
   * Deduplicates search evidence across all steps and strips crawler boilerplate.
   */
  public static formatObservationsForSynthesis(
    steps: AgentExecutionStep[],
    policy?: SearchPresentationPolicy
  ): string {
    if (!steps || steps.length === 0) {
      return '';
    }

    const observationSnippets: string[] = [];
    const seenSearchKeys = new Set<string>();

    for (const step of steps) {
      if (step.status === 'succeeded' || step.status === 'partial') {
        if (step.toolName === 'web_search') {
          const rawItems = this.extractSearchItems(step);
          if (rawItems.length > 0) {
            const { deduped } = this.deduplicateSearchResults(rawItems, seenSearchKeys);
            const lines: string[] = [];
            lines.push(`[Verified Result: ${step.toolName}]`);

            for (const item of deduped) {
              const urlInfo = policy?.shouldShowUrls && item.url ? ` | URL: ${item.url}` : '';
              const sourceInfo = item.sourceDomain || item.sourceName || '';
              const header = sourceInfo ? `[${sourceInfo}] ${item.title}` : `${item.title}`;
              lines.push(`- ${header}: ${item.snippet}${urlInfo}`);
            }

            observationSnippets.push(redactSecrets(lines.join('\n')));
            continue;
          }
        }

        // Standard non-search step
        const serialized =
          step.serializedResult ||
          (typeof step.result === 'object' ? JSON.stringify(step.result) : String(step.result || 'Success'));

        observationSnippets.push(`[Verified Result: ${step.toolName}]\n${redactSecrets(serialized)}`);
      } else if (step.status === 'failed') {
        const userSafeReason = step.error?.userSafeMessage || step.error?.message || 'Action could not be completed';
        observationSnippets.push(`[Failed Step: ${step.toolName}]\nReason: ${redactSecrets(userSafeReason)}`);
      }
    }

    return observationSnippets.join('\n\n');
  }

  /**
   * Builds an ExecutionContextSnapshot representing the structured execution state and token savings estimate.
   */
  public static buildSnapshot(steps: AgentExecutionStep[]): ExecutionContextSnapshot {
    const compactedObservations: ToolObservation[] = [];
    const allDeduplicatedEvidence: any[] = [];
    const seenSearchKeys = new Set<string>();
    let estimatedTokensSaved = 0;

    for (const step of steps) {
      if (step.status === 'succeeded' || step.status === 'partial') {
        if (step.toolName === 'web_search') {
          const rawItems = this.extractSearchItems(step);
          const { deduped, duplicatesRemoved } = this.deduplicateSearchResults(rawItems, seenSearchKeys);
          allDeduplicatedEvidence.push(...deduped);

          // Estimate ~120 tokens saved per duplicate result removed, plus boilerplate savings
          estimatedTokensSaved += duplicatesRemoved * 120;
          for (const item of rawItems) {
            const originalLength = (item.snippet || '').length;
            const cleanedLength = SearchEvidenceCompactor.cleanSnippetBoilerplate(item.snippet || '').length;
            const savedChars = Math.max(0, originalLength - cleanedLength);
            estimatedTokensSaved += Math.floor(savedChars / 4);
          }

          compactedObservations.push({
            stepId: step.id,
            toolName: step.toolName,
            status: step.status,
            summary: `Found ${deduped.length} distinct source(s) (${duplicatesRemoved} duplicates removed)`,
            structuredData: deduped,
          });
          continue;
        }

        compactedObservations.push({
          stepId: step.id,
          toolName: step.toolName,
          status: step.status,
          summary: `Step succeeded with outcome`,
          structuredData: step.result,
        });
      } else if (step.status === 'failed') {
        compactedObservations.push({
          stepId: step.id,
          toolName: step.toolName,
          status: 'failed',
          summary: 'Step failed execution',
          errorReason: step.error?.userSafeMessage || step.error?.message || 'Failed',
        });
      }
    }

    return {
      compactedObservations,
      deduplicatedEvidence: allDeduplicatedEvidence,
      estimatedTokensSaved,
    };
  }
}
