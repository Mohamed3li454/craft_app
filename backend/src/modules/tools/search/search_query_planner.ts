/**
 * Search Query Planner (Phase 9.3)
 *
 * Translates raw user inquiries into structured search plans:
 * - Intent classification
 * - Conversational fluff removal
 * - Geo-targeting extraction
 * - Provider selection based on intent
 * - Alternative query generation for bounded 1-shot refinement
 */

import { SearchIntent, SearchQueryPlan, PreferredSearchProvider, FreshnessTarget } from './search.types';
import { SearchIntentClassifier } from './search_intent_classifier';
import { LanguageContext } from '../../language/types';

export class SearchQueryPlanner {
  /**
   * Plans the search execution based on user query, intent, and language context.
   */
  public static plan(rawUserQuery: string, languageContext?: LanguageContext): SearchQueryPlan {
    const raw = (rawUserQuery || '').trim();
    const intent = SearchIntentClassifier.classify(raw, languageContext);
    const cleanedQuery = this.cleanConversationalPadding(raw);
    const geoTargeting = this.detectGeoTargeting(raw, languageContext);
    const languageConstraint = languageContext?.targetLanguage || (this.isArabic(raw) ? 'ar' : 'en');

    const preferredProvider = this.selectPreferredProvider(intent);
    const freshnessTarget = this.computeFreshnessTarget(intent);
    const alternativeQuery = this.generateAlternativeQuery(cleanedQuery, intent, languageConstraint);

    return {
      rawUserQuery: raw,
      plannedQuery: cleanedQuery || raw,
      alternativeQuery,
      intent,
      languageConstraint,
      geoTargeting,
      freshnessTarget,
      preferredProvider,
    };
  }

  /**
   * Selects the most appropriate search provider based on query intent.
   * Invariant: Historical and Evergreen queries NEVER use Google News as primary!
   */
  public static selectPreferredProvider(intent: SearchIntent): PreferredSearchProvider {
    switch (intent) {
      case 'breaking_news':
        return 'google_news';
      case 'technical_docs':
        return 'duckduckgo';
      case 'historical_fact':
        // Historical queries MUST prioritize general encyclopedic/factual web sources over current news
        return 'duckduckgo';
      case 'evergreen_knowledge':
        return 'duckduckgo';
      case 'technical_release':
      case 'latest_product':
      case 'general_web':
      default:
        return 'duckduckgo';
    }
  }

  /**
   * Computes freshness bounds according to the intent.
   */
  public static computeFreshnessTarget(intent: SearchIntent): FreshnessTarget | undefined {
    switch (intent) {
      case 'breaking_news':
        return { maxAgeHours: 24 };
      case 'latest_product':
        return { maxAgeDays: 30 };
      case 'technical_release':
        return { maxAgeDays: 90 };
      case 'historical_fact':
      case 'technical_docs':
      case 'evergreen_knowledge':
      case 'general_web':
      default:
        return undefined;
    }
  }

  /**
   * Generates a focused alternative query for 1-time search refinement if primary search yields poor results.
   */
  public static generateAlternativeQuery(
    cleanedQuery: string,
    intent: SearchIntent,
    lang?: string
  ): string | undefined {
    const words = cleanedQuery.split(/\s+/).filter(Boolean);
    if (words.length === 0) return undefined;

    // Technical release queries: ensure English keywords for international frameworks
    if (intent === 'technical_release') {
      const techMatch = cleanedQuery.match(/\b(flutter|react|node|python|dart|rust|docker|kubernetes|swift|kotlin)\b/i);
      if (techMatch) {
        return `${techMatch[1]} latest stable release official`;
      }
      return `${cleanedQuery} latest version changelog`;
    }

    // Technical docs queries
    if (intent === 'technical_docs') {
      const techMatch = cleanedQuery.match(/\b(flutter|react|node|python|dart|rust|docker|kubernetes|swift|kotlin)\b/i);
      if (techMatch) {
        return `${techMatch[1]} official documentation guide`;
      }
      return `${cleanedQuery} official documentation`;
    }

    // Historical queries: strip news indicators and add encyclopedia keywords
    if (intent === 'historical_fact') {
      const stripped = cleanedQuery.replace(/(اليوم|الآن|حديث|أخبار)/g, '').trim();
      return `${stripped} تاريخ حقائق`;
    }

    // Breaking news: append current year if missing
    if (intent === 'breaking_news') {
      const currentYear = new Date().getFullYear();
      if (!cleanedQuery.includes(String(currentYear))) {
        return `${cleanedQuery} ${currentYear}`;
      }
    }

    // Latest product
    if (intent === 'latest_product') {
      return `${cleanedQuery} مواصفات رسمية`;
    }

    // Fallback: simplified keywords
    if (words.length > 4) {
      return words.slice(0, 4).join(' ');
    }

    return undefined;
  }

  /**
   * Removes conversational fluff while preserving all core entities.
   */
  public static cleanConversationalPadding(text: string): string {
    let cleaned = text;

    const arabicPrefixes = [
      /^لو سمحت\s+(دورلي على|ابحثلي عن|ابحث عن|شفلي|شوفلي|قولي|قول لي)?/i,
      /^ممكن\s+(تبحث عن|تدور على|تقولي|تعرفني|تجيبلي)?/i,
      /^عايز\s+(اعرف|أعرف|افهم|أفهم|اشوف|أشوف)?/i,
      /^عاوز\s+(اعرف|أعرف|افهم|أفهم|اشوف|أشوف)?/i,
      /^ابحث عن\s+/i,
      /^دور على\s+/i,
      /^شف لي\s+/i,
      /^شوف لي\s+/i,
      /^بالله عليك\s+/i,
      /^يا ريت تقولي\s+/i,
    ];

    const englishPrefixes = [
      /^(please\s+)?(search for|look up|find information about|find me|tell me about|can you tell me)\s+/i,
      /^(i want to know|i'd like to know|what can you tell me about)\s+/i,
    ];

    for (const prefix of [...arabicPrefixes, ...englishPrefixes]) {
      cleaned = cleaned.replace(prefix, '').trim();
    }

    return cleaned || text;
  }

  /**
   * Detects geographical target from query text or language context.
   */
  public static detectGeoTargeting(query: string, languageContext?: LanguageContext): string {
    const lower = query.toLowerCase();

    if (/سعودي|سعودية|الرياض|جدة|الدمام|المملكة|\bksa\b/.test(lower)) {
      return 'SA';
    }
    if (/إمارات|امارات|دبي|أبوظبي|ابوظبي|الشارقة|\buae\b/.test(lower)) {
      return 'AE';
    }
    if (/كويت|\bkuwait\b/.test(lower)) {
      return 'KW';
    }
    if (/أردن|اردن|عمان|\bjordan\b/.test(lower)) {
      return 'JO';
    }
    if (/مغرب|رباط|كازا|دار البيضاء|\bmorocco\b/.test(lower)) {
      return 'MA';
    }
    if (/مصر|القاهرة|الإسكندرية|الاسكندرية|\begypt\b/.test(lower)) {
      return 'EG';
    }

    // Default based on languageContext locale if available
    if (languageContext?.locale) {
      const parts = languageContext.locale.split('-');
      if (parts.length > 1) {
        return parts[1].toUpperCase();
      }
    }

    return this.isArabic(query) ? 'EG' : 'US';
  }

  private static isArabic(text: string): boolean {
    return /[\u0600-\u06FF]/.test(text);
  }
}
