import { SemanticCacheCandidate } from '../../../database/repositories/semantic_candidate.types';
import { DEFAULT_EVIDENCE_CONFIG, EvidenceThresholdConfig } from './evidence.config';
import { ConflictDetector } from './conflict_detector';
import { StalenessEvaluator } from './staleness_evaluator';
import { EmbeddingProvider } from '../embedding/embedding.interface';

export interface PromotionEvaluation {
  eligible: boolean;
  score: number;
  reasons: string[];
  blockers: string[];
  evidence: {
    observations: number;
    uniqueExamples: number;
    semanticConsistency?: number;
    validationCount: number;
    safetyViolations: number;
    duplicateCount: number;
  };
}

function computeCosine(a: number[], b: number[]): number {
  if (!a || !b || a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

export class PromotionEvaluator {
  /**
   * Deterministically calculates candidate confidence score and evaluates promotion eligibility.
   *
   * FORMULA SPECIFICATION:
   * Score = (W_obs * F_obs) + (W_div * F_div) + (W_sem * F_sem) + (W_val * F_val) - Penalties
   * Where:
   * - W_obs = 0.30, F_obs = min(1.0, observationCount / 10)
   * - W_div = 0.25, F_div = min(1.0, uniqueExampleCount / 5)
   * - W_sem = 0.25, F_sem = semanticConsistency (default 0.90 if single example)
   * - W_val = 0.20, F_val = status === 'validated' ? 1.0 : (status === 'pending' ? 0.5 : 0.0)
   * - Penalties = (0.50 * safetyViolations) + (0.50 * conflictCount)
   *
   * ELIGIBILITY REQUIREMENTS (ALL must pass):
   * 1. observations >= config.minObservations
   * 2. uniqueExamples >= config.minUniqueExamples
   * 3. semanticConsistency >= config.minSemanticConsistency
   * 4. confidence score >= config.minConfidenceScore
   * 5. safetyViolations <= config.maxSafetyViolations
   * 6. candidate is validated (status === 'validated')
   * 7. candidate is NOT stale
   * 8. candidate has NO unresolved conflicts
   */
  public static async evaluate(
    candidate: SemanticCacheCandidate,
    allCandidates: SemanticCacheCandidate[] = [],
    config: EvidenceThresholdConfig = DEFAULT_EVIDENCE_CONFIG,
    embeddingProvider?: EmbeddingProvider
  ): Promise<PromotionEvaluation> {
    const reasons: string[] = [];
    const blockers: string[] = [];

    // 1. Calculate or inherit Semantic Consistency across unique examples
    let semanticConsistency = candidate.semanticConsistency !== undefined && candidate.semanticConsistency !== null
      ? candidate.semanticConsistency
      : 0.90;

    if (
      (candidate.semanticConsistency === undefined || candidate.semanticConsistency === null) &&
      embeddingProvider &&
      embeddingProvider.name !== 'mock' &&
      candidate.inputExamples.length >= 2
    ) {
      try {
        const vectors = await Promise.all(
          candidate.inputExamples.slice(0, 5).map((ex) => embeddingProvider.embed(ex))
        );
        let pairSum = 0;
        let pairCount = 0;
        for (let i = 0; i < vectors.length; i++) {
          for (let j = i + 1; j < vectors.length; j++) {
            pairSum += computeCosine(vectors[i], vectors[j]);
            pairCount++;
          }
        }
        if (pairCount > 0) {
          semanticConsistency = parseFloat((pairSum / pairCount).toFixed(4));
        }
      } catch {
        // Fall back to existing or default semantic consistency
      }
    }

    // 2. Factor calculations
    const fObs = Math.min(1.0, candidate.observationCount / 10);
    const fDiv = Math.min(1.0, candidate.uniqueExampleCount / 5);
    const fSem = Math.min(1.0, Math.max(0.0, semanticConsistency));
    const fVal = candidate.status === 'validated' ? 1.0 : (candidate.status === 'pending' ? 0.5 : 0.0);

    const safetyPenalty = 0.50 * candidate.safetyViolationCount;
    const conflictPenalty = 0.50 * candidate.conflictCount;

    const weightedScore = (0.30 * fObs) + (0.25 * fDiv) + (0.25 * fSem) + (0.20 * fVal);
    const rawScore = weightedScore - safetyPenalty - conflictPenalty;
    const score = parseFloat(Math.max(0.0, Math.min(1.0, rawScore)).toFixed(4));

    // 3. Verification of Evidence Thresholds
    if (candidate.observationCount < config.minObservations) {
      blockers.push(`insufficient_observations: ${candidate.observationCount}/${config.minObservations}`);
    } else {
      reasons.push(`adequate_observations: ${candidate.observationCount}`);
    }

    if (candidate.uniqueExampleCount < config.minUniqueExamples) {
      blockers.push(`insufficient_unique_examples: ${candidate.uniqueExampleCount}/${config.minUniqueExamples}`);
    } else {
      reasons.push(`diverse_examples: ${candidate.uniqueExampleCount}`);
    }

    if (semanticConsistency < config.minSemanticConsistency) {
      blockers.push(`low_semantic_consistency: ${semanticConsistency.toFixed(3)}/${config.minSemanticConsistency}`);
    } else {
      reasons.push(`high_semantic_consistency: ${semanticConsistency.toFixed(3)}`);
    }

    if (candidate.safetyViolationCount > config.maxSafetyViolations) {
      blockers.push(`safety_violations_present: ${candidate.safetyViolationCount}`);
    }

    if (candidate.status !== 'validated') {
      blockers.push(`not_validated: current status is ${candidate.status}`);
    } else {
      reasons.push('human_or_rule_validated');
    }

    if (score < config.minConfidenceScore) {
      blockers.push(`score_below_threshold: ${score.toFixed(3)}/${config.minConfidenceScore}`);
    } else {
      reasons.push(`confidence_threshold_met: ${score.toFixed(3)}`);
    }

    // 4. Staleness Check
    const staleness = StalenessEvaluator.isStale(candidate, config);
    if (staleness.isStale) {
      blockers.push(`candidate_is_stale: ${staleness.reason}`);
    } else {
      reasons.push('fresh_and_active');
    }

    // 5. Conflict Check
    const conflict = ConflictDetector.detectConflict(candidate, allCandidates);
    if (conflict.hasConflict) {
      blockers.push(`conflict_detected: ${conflict.details}`);
    }
    if (candidate.conflictCount > 0) {
      blockers.push(`conflict_count_present: ${candidate.conflictCount}`);
    }

    const eligible = blockers.length === 0;

    return {
      eligible,
      score,
      reasons,
      blockers,
      evidence: {
        observations: candidate.observationCount,
        uniqueExamples: candidate.uniqueExampleCount,
        semanticConsistency,
        validationCount: candidate.validationCount,
        safetyViolations: candidate.safetyViolationCount,
        duplicateCount: candidate.duplicateCount,
      },
    };
  }
}
