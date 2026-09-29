/**
 * Search Refiner (Phase 9.3)
 *
 * Implements bounded, 1-shot search refinement.
 * Guardrails:
 * - Maximum 1 refinement per search invocation (strictly prevents loops).
 * - Only triggered if:
 *   1. Initial result count < 2, OR
 *   2. Entity match score is 0 across all top results, OR
 *   3. Highest relevance score < 0.25.
 */

import { NormalizedSearchResult, SearchQueryPlan } from './search.types';
import { SearchRanker } from './search_ranker';

export interface RefinementDecision {
  shouldRefine: boolean;
  refinementQuery?: string;
  reason?: string;
}

export class SearchRefiner {
  /**
   * Decides whether a search should undergo a single refinement attempt.
   */
  public static evaluate(
    initialResults: NormalizedSearchResult[],
    plan: SearchQueryPlan,
    alreadyRefined: boolean
  ): RefinementDecision {
    // Invariant: strictly at most 1 refinement attempt
    if (alreadyRefined) {
      return { shouldRefine: false, reason: 'already_refined' };
    }

    if (!plan.alternativeQuery || plan.alternativeQuery === plan.plannedQuery) {
      return { shouldRefine: false, reason: 'no_alternative_query' };
    }

    // Condition 1: Poor quantity (< 2 results)
    if (initialResults.length < 2) {
      return {
        shouldRefine: true,
        refinementQuery: plan.alternativeQuery,
        reason: 'low_result_count',
      };
    }

    // Condition 2: Key entities missing in all top results
    const entities = SearchRanker.extractEntities(plan.plannedQuery);
    if (entities.length > 0) {
      const anyEntityMatch = initialResults.some((res) => {
        return (res.entityMatchScore ?? 0) > 0.3;
      });
      if (!anyEntityMatch) {
        return {
          shouldRefine: true,
          refinementQuery: plan.alternativeQuery,
          reason: 'entity_mismatch',
        };
      }
    }

    // Condition 3: Very low relevance across top results
    const topRelevance = initialResults[0]?.relevanceScore ?? 0;
    if (topRelevance < 0.25) {
      return {
        shouldRefine: true,
        refinementQuery: plan.alternativeQuery,
        reason: 'low_relevance',
      };
    }

    return { shouldRefine: false, reason: 'satisfactory_results' };
  }
}
