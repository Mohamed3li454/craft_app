/**
 * Configuration and Minimum Evidence Thresholds for Controlled Promotion (Phase 6).
 * Fully configurable via environment variables or direct injection, with zero magic numbers.
 */

export interface EvidenceThresholdConfig {
  minObservations: number;          // Minimum total observations required (default 5)
  minUniqueExamples: number;        // Minimum distinct canonical examples required (default 3)
  minSemanticConsistency: number;   // Minimum pairwise cosine similarity across examples (default 0.90)
  minConfidenceScore: number;       // Minimum weighted confidence score (default 0.90)
  maxSafetyViolations: number;      // Maximum tolerated past safety violations (default 0)
  maxStaleDays: number;             // Maximum allowed inactivity days before candidate is considered stale (default 90)
}

export const DEFAULT_EVIDENCE_CONFIG: EvidenceThresholdConfig = {
  minObservations: parseInt(process.env.LEARNING_MIN_OBSERVATIONS || '5', 10),
  minUniqueExamples: parseInt(process.env.LEARNING_MIN_UNIQUE_EXAMPLES || '3', 10),
  minSemanticConsistency: parseFloat(process.env.LEARNING_MIN_SEMANTIC_CONSISTENCY || '0.90'),
  minConfidenceScore: parseFloat(process.env.LEARNING_MIN_CONFIDENCE_SCORE || '0.70'),
  maxSafetyViolations: parseInt(process.env.LEARNING_MAX_SAFETY_VIOLATIONS || '0', 10),
  maxStaleDays: parseInt(process.env.LEARNING_MAX_STALE_DAYS || '90', 10),
};
