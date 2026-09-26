import { SemanticCacheCandidate } from '../../../database/repositories/semantic_candidate.types';
import { DEFAULT_EVIDENCE_CONFIG, EvidenceThresholdConfig } from './evidence.config';

export interface StalenessCheckResult {
  isStale: boolean;
  reason?: string;
  daysInactive: number;
}

// Sensitive keywords where business policies or pricing might evolve over time
const POTENTIALLY_VOLATILE_TOPICS = [
  /مواعيد/,
  /رسوم/,
  /سعر/,
  /أسعار/,
  /اسعار/,
  /تكلفة/,
  /باقة/,
  /باقات/,
  /اشتراك/,
  /خطة/,
  /خطط/,
  /سياسة/,
  /\b(pricing|fee|fees|cost|plan|plans|subscription|policy|schedule)\b/i,
];

export class StalenessEvaluator {
  /**
   * Deterministically evaluates whether a candidate has become stale.
   * Does NOT expire static timeless knowledge blindly.
   */
  public static isStale(
    candidate: SemanticCacheCandidate,
    config: EvidenceThresholdConfig = DEFAULT_EVIDENCE_CONFIG
  ): StalenessCheckResult {
    const now = Date.now();
    const lastObservedTime = new Date(candidate.lastObservedAt || candidate.createdAt).getTime();
    const diffDays = Math.floor((now - lastObservedTime) / (1000 * 60 * 60 * 24));

    // 1. If within active window (< maxStaleDays), candidate is definitely fresh
    if (diffDays <= config.maxStaleDays) {
      return { isStale: false, daysInactive: diffDays };
    }

    // 2. If candidate has very high observation count (>= 25) and is timeless knowledge, allow extended grace period
    const isVolatile = POTENTIALLY_VOLATILE_TOPICS.some(
      (regex) => regex.test(candidate.intent) || regex.test(candidate.response)
    );

    if (!isVolatile && candidate.observationCount >= 25 && diffDays <= config.maxStaleDays * 2) {
      return { isStale: false, daysInactive: diffDays };
    }

    // 3. Low-frequency or policy/pricing candidates that haven't been observed in > maxStaleDays are marked stale
    return {
      isStale: true,
      reason: `Candidate has been inactive for ${diffDays} days (threshold: ${config.maxStaleDays} days)`,
      daysInactive: diffDays,
    };
  }
}
