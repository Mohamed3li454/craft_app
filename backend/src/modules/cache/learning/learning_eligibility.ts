import { EligibilityReason, SemanticCacheCandidate } from '../../../database/repositories/semantic_candidate.types';
import { isCacheEligible } from '../cache_safety';

export interface LearningRunAssessmentInput {
  userInput: string;
  replyText: string;
  toolCallsExecuted?: Array<{ toolName: string; arguments?: any; result?: any }>;
  modelUsed?: string;
}

export interface LearningEligibilityResult {
  eligible: boolean;
  reason: EligibilityReason;
  details?: string;
}

// Regex patterns to detect private/sensitive data in text
const EMAIL_REGEX = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/;
const PHONE_REGEX = /(?:\+?20|0)?1[0125]\d{8}\b|\b\d{10,14}\b/;
const API_KEY_REGEX = /\b(?:sk-[a-zA-Z0-9_-]{20,}|AIza[0-9A-Za-z-_]{35}|bearer\s+[a-zA-Z0-9._-]+|[0-9a-f]{16,40})\b/i;
const PERSONAL_PRONOUNS_USER_STATE_REGEX = /(?:\b(?:حسابي|رصيدي|بياناتي|طلبي|تذكيري|معلوماتي|اوردر|باسورد|كلمة السر)\b|my account|my order|my reminder|my balance|my profile)/i;

// Fallback & error response phrases that indicate bot degradation or failure
const ERROR_OR_FALLBACK_PATTERNS = [
  'حصل تهنيجة بسيطة',
  'called tool:',
  'tool [',
  'غير متوفرة',
  'حدث خطأ',
  'عذراً، حدث خطأ',
  'internal server error',
  'rate limit exceeded',
  'quota exceeded',
  'api error',
  'يرجى الإجابة مباشرة بدونها',
];

export class LearningEligibilityFilter {
  /**
   * Deterministic, zero-LLM filter to decide if an AI response is eligible
   * to become a candidate cache entry.
   */
  public static evaluate(input: LearningRunAssessmentInput): LearningEligibilityResult {
    const rawUserInput = (input.userInput || '').trim();
    const rawReply = (input.replyText || '').trim();

    // 1. Empty or whitespace response check
    if (!rawReply || rawReply.length === 0) {
      return {
        eligible: false,
        reason: 'empty_response',
        details: 'AI reply text is empty or missing',
      };
    }

    // 2. Low confidence & length checks
    if (rawReply.length < 15) {
      return {
        eligible: false,
        reason: 'low_confidence',
        details: 'AI reply text is too short to be a meaningful FAQ answer',
      };
    }

    const lowerReply = rawReply.toLowerCase();
    for (const pattern of ERROR_OR_FALLBACK_PATTERNS) {
      if (lowerReply.includes(pattern)) {
        return {
          eligible: false,
          reason: 'low_confidence',
          details: `AI reply matches known error or fallback signature: "${pattern}"`,
        };
      }
    }

    // 3. Tool-dependent checks
    const toolCalls = input.toolCallsExecuted || [];
    if (toolCalls.length > 0) {
      const hasSearch = toolCalls.some((t) => t.toolName === 'web_search');
      if (hasSearch) {
        return {
          eligible: false,
          reason: 'search_result',
          details: 'Response depends on live web search results',
        };
      }

      const toolNames = toolCalls.map((t) => t.toolName).join(', ');
      return {
        eligible: false,
        reason: 'tool_result',
        details: `Response depends on dynamic tool execution: [${toolNames}]`,
      };
    }

    // 4. Private information & Secrets checks
    if (EMAIL_REGEX.test(rawReply) || EMAIL_REGEX.test(rawUserInput)) {
      return {
        eligible: false,
        reason: 'private',
        details: 'Contains email address',
      };
    }

    if (PHONE_REGEX.test(rawReply) || PHONE_REGEX.test(rawUserInput)) {
      return {
        eligible: false,
        reason: 'private',
        details: 'Contains phone number or private numeric identifier',
      };
    }

    if (API_KEY_REGEX.test(rawReply) || API_KEY_REGEX.test(rawUserInput)) {
      return {
        eligible: false,
        reason: 'private',
        details: 'Contains API key, secret token, or security hash',
      };
    }

    // 5. User-specific / State checks
    if (PERSONAL_PRONOUNS_USER_STATE_REGEX.test(rawUserInput) || PERSONAL_PRONOUNS_USER_STATE_REGEX.test(rawReply)) {
      return {
        eligible: false,
        reason: 'user_specific',
        details: 'Contains personalized account, order, or state information',
      };
    }

    // 6. Dynamic & Time/Price/Weather checks (leveraging deterministic cache_safety rules)
    const safetyCheck = isCacheEligible(rawUserInput);
    if (!safetyCheck.eligible) {
      const reason: EligibilityReason = safetyCheck.reason === 'ineligible_user_context' ? 'user_specific' : 'dynamic';
      return {
        eligible: false,
        reason,
        details: `User input is not cache eligible: ${safetyCheck.reason}`,
      };
    }

    // Also check reply text for dynamic leakage
    const replySafetyCheck = isCacheEligible(rawReply);
    if (!replySafetyCheck.eligible) {
      const reason: EligibilityReason = replySafetyCheck.reason === 'ineligible_user_context' ? 'user_specific' : 'dynamic';
      return {
        eligible: false,
        reason,
        details: `AI reply contains dynamic content: ${replySafetyCheck.reason}`,
      };
    }

    // 7. Passes all filters -> Eligible as static reusable candidate
    return {
      eligible: true,
      reason: 'static_reusable',
      details: 'Response is static, factual, and safe for candidate consideration',
    };
  }
}
