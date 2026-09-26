import { SemanticCacheCandidate } from '../../../database/repositories/semantic_candidate.types';
import { TextNormalizer } from '../text_normalizer';

export interface ConflictCheckResult {
  hasConflict: boolean;
  reasons: string[];
  conflictingCandidateId?: string;
  details?: string;
}

// Polar opposite pairs that indicate direct factual contradiction
// Polar opposite pairs that indicate direct factual contradiction
const POLAR_OPPOSITE_PAIRS: Array<[RegExp, RegExp]> = [
  [
    /(?:^|[^\p{L}\p{N}])(?<!غير\s*)(مجاني|مجانا|بدون\s*رسوم)(?:[^\p{L}\p{N}]|$)/iu,
    /(?:^|[^\p{L}\p{N}])(مدفوع|برسوم|غير\s*مجاني|مقابل\s*رسوم)(?:[^\p{L}\p{N}]|$)/iu,
  ],
  [
    /(?:^|[^\p{L}\p{N}])(?<!غير\s*)(متاح|متوفر|موجود)(?:[^\p{L}\p{N}]|$)/iu,
    /(?:^|[^\p{L}\p{N}])(غير\s*متاح|غير\s*متوفر|غير\s*موجود|ملغي|معلق)(?:[^\p{L}\p{N}]|$)/iu,
  ],
  [
    /(?:^|[^\p{L}\p{N}])(?<!(?:لا|غير)\s*)(يدعم|مقبول|نعم)(?:[^\p{L}\p{N}]|$)/iu,
    /(?:^|[^\p{L}\p{N}])(لا\s*يدعم|غير\s*مقبول|مرفوض)(?:[^\p{L}\p{N}]|$)/iu,
  ],
  [
    /(?:^|[^\p{L}\p{N}])(?<!(?:لا|غير)\s*)(مسموح|يجوز)(?:[^\p{L}\p{N}]|$)/iu,
    /(?:^|[^\p{L}\p{N}])(غير\s*مسموح|ممنوع|لا\s*يجوز)(?:[^\p{L}\p{N}]|$)/iu,
  ],
  [
    /(?:^|[^\p{L}\p{N}])(?<!not\s*)free(?:[^\p{L}\p{N}]|$)/iu,
    /(?:^|[^\p{L}\p{N}])(paid|with\s*fee|charged)(?:[^\p{L}\p{N}]|$)/iu,
  ],
  [
    /(?:^|[^\p{L}\p{N}])(?<!(?:un|not\s*))(available|supported)(?:[^\p{L}\p{N}]|$)/iu,
    /(?:^|[^\p{L}\p{N}])(unavailable|not\s*supported|disabled)(?:[^\p{L}\p{N}]|$)/iu,
  ],
  [
    /(?:^|[^\p{L}\p{N}])(?<!not\s*)(yes|allowed)(?:[^\p{L}\p{N}]|$)/iu,
    /(?:^|[^\p{L}\p{N}])(no|not\s*allowed|forbidden)(?:[^\p{L}\p{N}]|$)/iu,
  ],
];

export class ConflictDetector {
  /**
   * Deterministically evaluates whether a candidate contradicts another candidate
   * for the same semantic intent.
   *
   * SCOPE & BOUNDARIES (Strictly Deterministic, Zero-LLM):
   * This detector handles supported deterministic conflict classes only:
   * 1. Numerical Conflicts: Differing figures/quantities/prices (e.g. 50 EGP vs 85 EGP).
   * 2. Polar Antonym Contradictions: Opposite claims on supported axes
   *    (e.g., Free vs Paid, Supported vs Unsupported, Available vs Unavailable).
   *
   * LIMITATION NOTE:
   * This detector does NOT claim to resolve arbitrary, nuanced natural language entailment
   * or general semantic contradictions that require an LLM. Any subtle semantic conflicts
   * outside these explicit structural classes are delegated to human review during validation.
   */
  public static detectConflict(
    target: SemanticCacheCandidate,
    allCandidates: SemanticCacheCandidate[]
  ): ConflictCheckResult {
    const targetResponse = target.response || '';
    const targetIntent = (target.intent || '').toLowerCase();
    const targetNumbers = (targetResponse.match(/\b\d+(?:\.\d+)?\b/g) || []).sort();

    for (const other of allCandidates) {
      if (other.id === target.id) continue;
      if (other.status === 'rejected') continue;

      const otherIntent = (other.intent || '').toLowerCase();
      const otherResponse = other.response || '';

      // Check if they target the same intent / concept
      const sameIntent = targetIntent === otherIntent;

      if (sameIntent) {
        // 1. Numerical conflict: different price / quantity numbers
        const otherNumbers = (otherResponse.match(/\b\d+(?:\.\d+)?\b/g) || []).sort();
        if (targetNumbers.length > 0 && otherNumbers.length > 0) {
          const numbersDiffer = targetNumbers.join(',') !== otherNumbers.join(',');
          if (numbersDiffer) {
            return {
              hasConflict: true,
              reasons: ['conflicting_numbers_detected'],
              conflictingCandidateId: other.id,
              details: `Competing candidate has differing figures (${targetNumbers.join(', ')} vs ${otherNumbers.join(', ')}) for intent "${target.intent}"`,
            };
          }
        }

        // 2. Polar contradiction check (e.g. Free vs Paid, Supported vs Unsupported)
        for (const [posRegex, negRegex] of POLAR_OPPOSITE_PAIRS) {
          const targetIsPos = posRegex.test(targetResponse);
          const targetIsNeg = negRegex.test(targetResponse);
          const otherIsPos = posRegex.test(otherResponse);
          const otherIsNeg = negRegex.test(otherResponse);

          if ((targetIsPos && otherIsNeg) || (targetIsNeg && otherIsPos)) {
            return {
              hasConflict: true,
              reasons: ['contradictory_factual_claim'],
              conflictingCandidateId: other.id,
              details: `Direct factual contradiction detected between candidate responses for intent "${target.intent}"`,
            };
          }
        }
      }
    }

    return {
      hasConflict: false,
      reasons: [],
    };
  }
}
