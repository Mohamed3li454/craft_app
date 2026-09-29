/**
 * Follow-up Detector & Query Contextualizer (Phase 5)
 *
 * Deterministically detects context-dependent messages, ellipsis, and demonstrative anaphora,
 * synthesizing an enriched contextualized query for memory retrieval and semantic caching.
 */

import { ConversationMessage } from './types';

export interface FollowUpAnalysisResult {
  readonly isFollowUp: boolean;
  readonly requiresContext: boolean;
  readonly contextualizedQuery: string;
}

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

export class FollowUpDetector {
  private static readonly SHORT_FOLLOW_UP_PATTERNS = [
    /احطه\s+فين/i,
    /بيتحط\s+فين/i,
    /طب\s+ليه/i,
    /ليه/i,
    /طب\s+ازاي/i,
    /ازاي\s+يعني/i,
    /ازاي/i,
    /ليه\s+بيحصل\s+كده/i,
    /وبعدين/i,
    /طب\s+وبالنسبه/i,
    /وبالنسبه/i,
    /سعرو?\s+كام/i,
    /بكام/i,
    /مواصفاته?\s+ايه/i,
    /طريقه\s+استخدامه/i,
    /ينفع\s+استخدمه/i,
    /هل\s+ينفع/i,
    /ينفع/i,
    /يشتغل\s+مع/i,
    /وريني\s+مثال/i,
    /^(?:اعمل(?:ها|ه|هم|لي|ليا)?)$/i,
    /^(?:نفذ(?:ها|ه|هم)?)$/i,
    /^(?:كمل(?:ها|ه)?)$/i,
    /^(?:اختصر(?:ها|ه|هولي)?)$/i,
    /^(?:لخص(?:ها|ه|هولي)?)$/i,
    /^(?:قارن(?:لي|هم)?)$/i,
    /\bwhere\s+does\s+(?:this|it)\b/i,
    /\bhow\s+do\s+i\s+use\s+(?:this|it)\b/i,
    /\bwhy\s+(?:is\s+that|so)\b/i,
    /\bwhat\s+about\b/i,
    /\bhow\s+about\b/i,
    /\band\s+then\b/i,
    /\bcan\s+i\s+use\s+it\b/i,
    /\bwhy\b/i,
    /\bhow\b/i,
  ];

  private static readonly DEMONSTRATIVE_WORDS = [
    'ده', 'وده', 'دي', 'ودي', 'هذا', 'وهذا', 'هذه', 'وهذه', 'فيه', 'وفيه', 'بيها', 'وبيها',
    'معاه', 'ومعاه', 'منه', 'ومنه', 'هنا', 'وهنا', 'هناك', 'وهناك',
    'it', 'this', 'that', 'them', 'these', 'there',
  ];

  public static analyze(
    query: string,
    activeTopic: string | null,
    recentMessages: readonly ConversationMessage[] = []
  ): FollowUpAnalysisResult {
    const trimmed = (query || '').trim();
    const norm = normalize(trimmed);

    // 1. Check if empty or standalone
    if (!trimmed) {
      return { isFollowUp: false, requiresContext: false, contextualizedQuery: trimmed };
    }

    // If there is no previous context at all, it cannot be a follow-up
    if (!recentMessages || recentMessages.length === 0) {
      return { isFollowUp: false, requiresContext: false, contextualizedQuery: trimmed };
    }

    // 2. Pattern Matching for direct short follow-ups
    const matchesShortPattern = this.SHORT_FOLLOW_UP_PATTERNS.some((p) => p.test(norm));

    // 3. Demonstrative references
    const hasDemonstrative = this.DEMONSTRATIVE_WORDS.some((word) => {
      const pattern = new RegExp(`(?:^|\\s|[.,!؟()_\\-])${word}(?:$|\\s|[.,!؟()_\\-])`, 'i');
      return pattern.test(norm);
    });

    // 4. Starts with conjunctions ("طب", "و", "and", "but")
    const startsWithConjunction = /^(?:طب|و|ف|لكن|and|but)\s*/i.test(norm);

    // 5. Short questions
    const isShortQuestion = trimmed.length <= 40 && (trimmed.includes('؟') || trimmed.includes('?') || matchesShortPattern);
    const isVeryShortWord = trimmed.length <= 10 && (norm === 'ليه' || norm === 'ليه؟' || norm === 'ازاي' || norm === 'ازاي؟' || norm === 'why' || norm === 'why?');

    const isFollowUp = matchesShortPattern || hasDemonstrative || (startsWithConjunction && isShortQuestion) || isVeryShortWord;
    const requiresContext = matchesShortPattern || hasDemonstrative || isVeryShortWord || (isShortQuestion && !trimmed.includes(activeTopic || '___'));

    // 6. Synthesize contextualized query
    let contextualizedQuery = trimmed;
    if (requiresContext && activeTopic) {
      if (matchesShortPattern || isVeryShortWord) {
        contextualizedQuery = `${trimmed} (الموضوع السياقي: ${activeTopic})`;
      } else {
        contextualizedQuery = `${trimmed} [السياق: ${activeTopic}]`;
      }
    }

    return {
      isFollowUp,
      requiresContext,
      contextualizedQuery,
    };
  }
}
