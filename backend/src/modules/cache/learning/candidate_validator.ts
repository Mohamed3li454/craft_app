import { SemanticCacheCandidate } from '../../../database/repositories/semantic_candidate.types';
import { ResponseStrategy } from '../../../database/repositories/semantic_cache.types';
import { isCacheEligible } from '../cache_safety';

export interface CandidateValidationResult {
  valid: boolean;
  reason?: string;
  details?: string;
}

const SUPPORTED_STRATEGIES: ResponseStrategy[] = [
  'static',
  'dynamic_template',
  'contextual_template',
  'slot_based',
  'ai_fallback',
];

const SUPPORTED_PLACEHOLDERS = new Set([
  'user_name',
  'channel',
  'today_date',
  'current_year',
  'currency',
]);

const SECRET_OR_KEY_REGEX = /\b(?:sk-[a-zA-Z0-9_-]{20,}|AIza[0-9A-Za-z-_]{35}|bearer\s+[a-zA-Z0-9._-]+|[0-9a-f]{16,40})\b/i;
const PHONE_NUMBER_REGEX = /(?:\+?20|0)?1[0125]\d{8}\b|\b\d{10,14}\b/;
const EMAIL_REGEX = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/;

export class CandidateValidator {
  /**
   * Performs rigorous deterministic validation before a candidate can be
   * approved or promoted.
   */
  public static validate(candidate: SemanticCacheCandidate): CandidateValidationResult {
    // 1. Metadata Checks
    if (!candidate.intent || candidate.intent.trim().length === 0) {
      return {
        valid: false,
        reason: 'missing_intent',
        details: 'Candidate must have a non-empty intent name',
      };
    }

    if (!SUPPORTED_STRATEGIES.includes(candidate.responseStrategy)) {
      return {
        valid: false,
        reason: 'invalid_strategy',
        details: `Strategy "${candidate.responseStrategy}" is not a recognized ResponseStrategy`,
      };
    }

    if (!candidate.language || candidate.language.trim().length === 0) {
      return {
        valid: false,
        reason: 'missing_language',
        details: 'Candidate must specify a valid language code or "default"',
      };
    }

    if (!candidate.inputExamples || candidate.inputExamples.length === 0) {
      return {
        valid: false,
        reason: 'missing_examples',
        details: 'Candidate must contain at least one input example',
      };
    }

    // 2. Content Checks
    const response = (candidate.response || '').trim();
    if (response.length === 0) {
      return {
        valid: false,
        reason: 'empty_response',
        details: 'Response text is missing or blank',
      };
    }

    if (response.length < 15) {
      return {
        valid: false,
        reason: 'short_response',
        details: 'Response text is too short to be an informative cache entry',
      };
    }

    // Dynamic content check
    const safetyCheck = isCacheEligible(response);
    if (!safetyCheck.eligible) {
      return {
        valid: false,
        reason: 'dynamic_content',
        details: `Response contains dynamic elements: ${safetyCheck.reason}`,
      };
    }

    // Check input examples for dynamic triggers
    for (const ex of candidate.inputExamples) {
      const exSafety = isCacheEligible(ex);
      if (!exSafety.eligible) {
        return {
          valid: false,
          reason: 'dynamic_example',
          details: `Input example "${ex}" is dynamic: ${exSafety.reason}`,
        };
      }
    }

    // 3. Safety & Privacy Checks
    if (SECRET_OR_KEY_REGEX.test(response)) {
      return {
        valid: false,
        reason: 'contains_secrets',
        details: 'Response contains potential API key or secret token',
      };
    }

    if (PHONE_NUMBER_REGEX.test(response)) {
      return {
        valid: false,
        reason: 'contains_phone_number',
        details: 'Response contains private phone number or numeric contact ID',
      };
    }

    if (EMAIL_REGEX.test(response)) {
      return {
        valid: false,
        reason: 'contains_email',
        details: 'Response contains private email address',
      };
    }

    // Template placeholder validation
    const placeholderMatches = response.match(/\{\{([a-zA-Z0-9_]+)\}\}/g);
    if (placeholderMatches) {
      for (const m of placeholderMatches) {
        const key = m.replace(/\{\{|\}\}/g, '').trim();
        if (!SUPPORTED_PLACEHOLDERS.has(key)) {
          return {
            valid: false,
            reason: 'unsupported_placeholder',
            details: `Template uses unsupported placeholder "{{${key}}}"`,
          };
        }
      }
    }

    // All validation checks passed cleanly
    return {
      valid: true,
    };
  }
}
