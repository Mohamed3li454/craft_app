/**
 * Clarification Gatekeeper for Adaptive Response Intelligence (Phase 6)
 *
 * Deterministically decides whether Craft MUST request clarifying details before proceeding,
 * or whether the query can be answered directly using context or reasonable defaults.
 *
 * Invariants:
 * - Never hallucinates or guesses when critical prerequisite information is missing.
 * - Never pesters the user with unnecessary clarifications when standard defaults or
 *   conversation context (Phase 5 contextualizedQuery) suffice.
 */

import { ClarificationDecision } from './types';
import { ConversationState, ConversationMessage } from '../conversation/types';

function normalize(text: string): string {
  if (!text) return '';
  return text
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/\u0640/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .trim();
}

export class ClarificationGate {
  // Generic failure complaints with zero details
  private static readonly VAGUE_FAILURE_PATTERNS = [
    /^(?:الكود\s+(?:مش\s+شغال|بيفشل|واقف|معلق|بايظ))$/i,
    /^(?:مش\s+شغال(?:ه)?|مش\s+بيشتغل|بيطلع\s+(?:لي\s+)?(?:error|ايرور|خطا|مشكله))$/i,
    /^(?:في\s+(?:error|ايرور|خطا|مشكله)\s+في\s+الكود)$/i,
    /^(?:it(?:'s)?\s+(?:not\s+working|broken|failing|crashes))$/i,
    /^(?:my\s+code\s+(?:is\s+not\s+working|fails|throws\s+an\s+error))$/i,
    /^(?:getting\s+an\s+error)$/i,
  ];

  // Ambiguous demonstrative references with unknown referent
  private static readonly AMBIGUOUS_REFERENT_PATTERNS = [
    /^(?:اعمل(?:ها|ه)?\s+بالطريق[هة]\s+دي)$/i,
    /^(?:نفس\s+الحاج[هة]\s+دي)$/i,
    /^(?:طب\s+ودي؟|وده؟|ودا؟)$/i,
    /^(?:do\s+it\s+(?:like\s+this|this\s+way))$/i,
    /^(?:same\s+thing)$/i,
  ];

  // Underspecified action commands that require a concrete actionable antecedent or clarification
  private static readonly UNDERSPECIFIED_ACTION_PATTERNS = [
    /^(?:اعمل(?:ها|ه|هم|لي|ليا)?)$/i,
    /^(?:اعملي(?:ها|ه)?)$/i,
    /^(?:نفذ(?:ها|ه|هم)?)$/i,
    /^(?:نفذ\s+(?:ده|دا|دي|كده))$/i,
    /^(?:اعمل\s+(?:ده|دا|دي|كده))$/i,
    /^(?:كمل(?:ها|ه)?)$/i,
    /^(?:كمل)$/i,
    /^(?:اختصر(?:ها|ه)?)$/i,
    /^(?:لخص(?:ها|ه)?)$/i,
    /^(?:عدل(?:ها|ه)?)$/i,
    /^(?:صلح(?:ها|ه)?)$/i,
    /^(?:اكتب(?:ها|ه)?)$/i,
    /^(?:طبق(?:ها|ه)?)$/i,
    /^(?:do\s+it)$/i,
    /^(?:execute\s+it)$/i,
    /^(?:implement\s+it)$/i,
    /^(?:continue)$/i,
    /^(?:apply\s+it)$/i,
  ];

  /**
   * Determines if the previous turn contains an explicit, singular actionable proposal/question
   * that can directly anchor an underspecified action command like "اعملها".
   */
  private static hasConcreteActionableAntecedent(
    recentMessages: readonly ConversationMessage[]
  ): boolean {
    if (!recentMessages || recentMessages.length === 0) return false;

    // Find the last assistant message
    const lastAssistant = [...recentMessages].reverse().find((m) => m.role === 'assistant');
    if (!lastAssistant || !lastAssistant.text) return false;

    const norm = normalize(lastAssistant.text);

    // Explicit offers/questions by the assistant proposing an actionable next step
    const actionableOffers = [
      /تحب\s+(?:اعملك|اكتبلك|اجيبلك|اشرحلك|الخصلك|اوضحلك|نعمل)/i,
      /هل\s+تريد\s+(?:مني\s+)?(?:ان\s+)?(?:اكتب|انشئ|اقوم|اعمل|الخص)/i,
      /لو\s+تحب\s+(?:اعمل|اكتب|انفذ)/i,
      /ممكن\s+(?:اعملك|اكتبلك)/i,
      /would\s+you\s+like\s+me\s+to\s+(?:create|write|implement|summarize|compare)/i,
      /shall\s+i\s+(?:create|write|implement|summarize|compare)/i,
      /do\s+you\s+want\s+me\s+to/i,
    ];

    return actionableOffers.some((p) => p.test(norm));
  }

  /**
   * Evaluates if a clarification question is required.
   */
  public static evaluate(
    query: string,
    conversationState: ConversationState,
    recentMessages: readonly ConversationMessage[] = []
  ): ClarificationDecision {
    const raw = (query || '').trim();
    if (!raw) {
      return { required: false };
    }

    const norm = normalize(raw);

    // Prior context exists if there were prior turns with assistant response or meaningful user turns
    const hasPriorAntecedent = recentMessages.length > 0 &&
      recentMessages.some((m) => m.role === 'assistant' || m.text.length > 15);

    const isEnriched = conversationState.contextualizedQuery.includes('الموضوع السياقي') ||
      conversationState.contextualizedQuery.includes('Contextual Topic');

    // Rule 1: Underspecified Action Intent Gate
    // If the user says "اعملها", "نفذها", "كمل", etc.
    const isUnderspecifiedAction = this.UNDERSPECIFIED_ACTION_PATTERNS.some((p) => p.test(norm));
    if (isUnderspecifiedAction) {
      const hasConcreteAction = this.hasConcreteActionableAntecedent(recentMessages);
      if (!hasConcreteAction) {
        return {
          required: true,
          reason: 'ambiguous_referent',
          targetedAspect: 'action_intent',
          suggestedClarification: 'تقصد أعمل إيه بالظبط؟ تحب مثلاً أكتبلك كود عملي، ولا أعمل جدول مقارنة، ولا توضيح خطوة بخطوة؟',
          suggestedOptions: ['كود عملي يوضح الفكرة', 'جدول مقارنة تفصيلي', 'خطوات التطبيق خطوة بخطوة'],
        };
      }
    }

    // Rule 1.5: Context-Resolvable Follow-up Protection
    // If Phase 5 successfully resolved the referent via contextualizedQuery or prior turns,
    // NEVER interrupt the user with clarification!
    if (!isUnderspecifiedAction && conversationState.isFollowUp && (hasPriorAntecedent || isEnriched)) {
      return { required: false };
    }

    // Rule 2: Ambiguous Referents with zero prior context
    const isAmbiguousReferent = this.AMBIGUOUS_REFERENT_PATTERNS.some((p) => p.test(norm));
    if (isAmbiguousReferent && !hasPriorAntecedent && !isEnriched) {
      return {
        required: true,
        reason: 'ambiguous_referent',
        targetedAspect: 'referent',
        suggestedClarification: 'عفواً، ما هي الطريقة أو العنصر المقصود بالضبط لنتمكن من المتابعة بدقة؟',
      };
    }

    // Rule 3: Missing Critical Information
    // If user states code is broken, but provides ZERO code snippet, ZERO error code/name,
    // and no relevant technical context exists in recent turns.
    const isVagueFailure = this.VAGUE_FAILURE_PATTERNS.some((p) => p.test(norm));
    if (isVagueFailure) {
      const hasCodeSnippet = /[`{}[\]();=]/.test(raw);
      const hasErrorCode = /\b(?:401|403|404|500|nullpointer|overflow|typeerror|referenceerror|syntaxerror|exception)\b/i.test(raw);

      if (!hasCodeSnippet && !hasErrorCode && !hasPriorAntecedent && !isEnriched) {
        return {
          required: true,
          reason: 'missing_critical_context',
          targetedAspect: 'error_or_code',
          suggestedClarification: 'يرجى تزويدي بنص رسالة الخطأ (Error Message) أو جزء الكود المعني لنتمكن من تشخيص المشكلة بدقة.',
          suggestedOptions: ['رسالة الخطأ الظاهرة في الـ Console', 'كود الدالة أو الملف المتأثر'],
        };
      }
    }

    // Rule 4: Broad/Optional questions (e.g. "ازاي أعمل API في Flutter؟")
    // Safe to provide standard default approach with variants. Zero clarification.
    return { required: false };
  }
}
