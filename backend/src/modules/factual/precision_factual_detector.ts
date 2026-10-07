/**
 * Precision Factual Detector (Phase 15.1F)
 *
 * Deterministic multi-signal classifier for high-precision factual queries.
 * Identifies queries requiring strict external verification (e.g. multi-part franchise
 * chronologies, release orders, multi-entity attribute matrices, historical sequences,
 * and user corrections/verifications).
 *
 * Guaranteed Properties:
 * - 100% deterministic (zero external LLM calls, zero network latency).
 * - Distinguishes complex multi-entity/chronological queries from single-entity
 *   foundational facts (e.g. "مين مؤسس Apple؟", "عاصمة فرنسا", "ما هو Flutter" remain NORMAL).
 * - Fail-safe scoring with explicit signals explanation.
 */

import {
  FactualCategory,
  FactualEvaluationResult,
  FactualPrecisionPolicy,
} from './factual_grounding.types';

export class PrecisionFactualDetector {
  /**
   * Deterministically evaluates the user query to classify its factual precision requirements.
   */
  public static evaluate(query?: string): FactualEvaluationResult {
    const raw = (query || '').trim();
    if (!raw) {
      return {
        policy: 'NORMAL',
        score: 0,
        signals: ['EMPTY_QUERY'],
        requiresSearch: false,
        reason: 'Empty query defaults to NORMAL factual policy',
      };
    }

    const cleanText = this.normalizeText(raw);
    const signals: string[] = [];
    let score = 0;
    let category: FactualCategory | undefined;

    // 1. First-class Correction & Verification Signals (Top Priority)
    if (this.matchesCorrectionOrVerification(cleanText)) {
      score += 0.95;
      signals.push('FACTUAL_VERIFICATION_OR_CORRECTION');
      category = 'FACTUAL_VERIFICATION_OR_CORRECTION';
    }

    // 2. Chronology & Release Order Detection
    const hasOrderSignal = this.matchesOrderSignals(cleanText);
    const hasFranchiseSignal = this.matchesFranchiseOrSeries(cleanText);
    const hasAttributeSignal = this.matchesMultiEntityAttributes(cleanText);

    if (hasAttributeSignal) {
      score = Math.max(score, 0.90);
      signals.push('MULTI_ENTITY_ATTRIBUTES');
      category = 'MULTI_ENTITY_ATTRIBUTES';
    } else if (hasOrderSignal && hasFranchiseSignal) {
      score = Math.max(score, 0.95);
      signals.push('CHRONOLOGY_FRANCHISE_COMPOUND');
      category = category || 'CHRONOLOGY_OR_RELEASE_ORDER';
    } else if (hasOrderSignal) {
      score += 0.65;
      signals.push('CHRONOLOGY_ORDER_SIGNAL');
      category = category || 'CHRONOLOGY_OR_RELEASE_ORDER';
    }

    // 4. Franchise recognition on its own
    if (hasFranchiseSignal && !hasOrderSignal && !hasAttributeSignal) {
      // Mentioning a franchise alone without order or attributes might be general
      score += 0.25;
      signals.push('FRANCHISE_MENTION');
    }

    // 5. Exact Historical Sequence / Ruler / Battle Detection
    if (this.matchesHistoricalSequenceOrRuler(cleanText)) {
      score += 0.75;
      signals.push('HISTORICAL_SEQUENCE_OR_RULER');
      category = category || 'HISTORICAL_EVENT_OR_RULER';
    }

    // 6. Specific Technical Version / Benchmark
    if (this.matchesTechnicalVersionOrBenchmark(cleanText)) {
      score += 0.70;
      signals.push('TECHNICAL_SPEC_OR_VERSION');
      category = category || 'TECHNICAL_SPEC_OR_VERSION';
    }

    // 7. Negative Guard: Single-hop foundational facts remain NORMAL
    // Only check negative filter if NOT already flagged by explicit correction or high-confidence chronology
    if (category !== 'FACTUAL_VERIFICATION_OR_CORRECTION' && !(hasOrderSignal && hasFranchiseSignal)) {
      if (this.isSingleHopFoundationalFact(cleanText)) {
        signals.push('SINGLE_HOP_FOUNDATIONAL_FACT_EXCLUSION');
        return {
          policy: 'NORMAL',
          category: 'GENERAL_KNOWLEDGE',
          score: 0.1,
          signals,
          requiresSearch: false,
          reason: 'Single-hop foundational fact (founder, capital, definition) handled reliably by parametric memory',
        };
      }
    }

    // Cap score at 1.0
    score = Math.min(1.0, score);

    // Policy determination
    let policy: FactualPrecisionPolicy = 'NORMAL';
    let requiresSearch = false;

    if (score >= 0.70) {
      policy = 'PRECISION_FACTUAL';
      requiresSearch = true;
    } else if (score >= 0.40) {
      policy = 'FACTUAL_ENHANCED';
      requiresSearch = false;
    }

    return {
      policy,
      category,
      score,
      signals,
      requiresSearch,
      reason:
        policy === 'PRECISION_FACTUAL'
          ? `High precision factual requirements identified (${category || 'GENERAL'}) - external verification mandatory`
          : policy === 'FACTUAL_ENHANCED'
          ? `Moderate factual context identified (${category || 'GENERAL'})`
          : 'Standard conversational or general knowledge query - NORMAL factual policy',
    };
  }

  public static normalizeText(text: string): string {
    return (text || '')
      .toLowerCase()
      .replace(/[\u064B-\u065F\u0670]/g, '') // remove Arabic diacritics
      .replace(/[أإآ]/g, 'ا')
      .replace(/ة/g, 'ه')
      .replace(/ى/g, 'ي')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Matches explicit user correction or fact verification requests.
   */
  private static matchesCorrectionOrVerification(text: string): boolean {
    const patterns = [
      /(صححلي|صحح لي|تصحيح|التصحيح الكامل|الكلام ده مش صح|الكلام ده غلط|مش صح|غلط|معلومه غلط)/,
      /(هل الكلام ده صح|هل ده صح|هل فعلا|اتأكد من|اتاكد من|اتأكدلي|اتاكدلي|راجعلي|راجع لي|راجع الاسماء|راجع الترتيب)/,
      /(مين ده|مين الشخصيه دي|مفيش حد اسمه|مفيش شخصيه اسمها|مين قال كده|انت متاكد|انت متأكد)/,
      /(انت قلتلي قبل كده|قلتلي قبل كده|قلت لي قبل كده|مين\s+[\w\u0600-\u06FF\s]{1,30}\s+ده)/,
      /\b(is this correct|is that true|correct this|check your facts|that is wrong|you made a mistake|who is that|verify this)\b/,
    ];
    return patterns.some((p) => p.test(text));
  }

  /**
   * Matches chronological, sequence, or release order phrasing.
   */
  private static matchesOrderSignals(text: string): boolean {
    const patterns = [
      /(ترتيب|رتبلي|رتب لي|تسلسل|سلسله|سلاسل|اجزاء|الاجزاء)/,
      /(بالترتيب|من البدايه|من البدايه للنهايه|مين نزل الاول|مين الاول|مين قبل مين|قبل ولا بعد)/,
      /(تواريخ اصدار|تاريخ صدور|تاريخ نزول|سنة اصدار|سنه نزول|ترتيب زمني|ترتيب نزول)/,
      /\b(chronological|chronology|release order|play order|watch order|timeline|in order|order of release)\b/,
      /\b(which came first|before or after|all parts in order|part 1|part 2)\b/,
    ];
    return patterns.some((p) => p.test(text));
  }

  /**
   * Matches well-known multi-part franchises, media universes, and gaming series.
   */
  private static matchesFranchiseOrSeries(text: string): boolean {
    const patterns = [
      /(assassin|assassins|اساسنز|اساسن|كريد|creed)/,
      /(god of war|جود اوف وور|كول اوف ديوتي|call of duty|ريزيدنت ايفل|resident evil)/,
      /(gta|grand theft auto|حرامي السيارات|ذا ويتشر|witcher|ميتال جير|metal gear)/,
      /(سيد الخواتم|lord of the rings|هاري بوتر|harry potter|مارفل|marvel|mcu|حرب النجوم|star wars)/,
      /(سلسل[ةه] افلام|سلسل[ةه] العاب|اجزاء فيلم|اجزاء لعبه|سلسل[ةه] روايات|مواسم مسلسل)/,
      /\b(game franchise|movie franchise|book series|game series)\b/,
    ];
    return patterns.some((p) => p.test(text));
  }

  /**
   * Matches queries requesting multi-entity attribute matrices across parts.
   */
  private static matchesMultiEntityAttributes(text: string): boolean {
    const patterns = [
      /(مين بطل كل|ابطال الاجزاء|شخصيات كل جزء|بطل كل جزء)/,
      /(الفتره التاريخيه لكل|الحقبه الزمنيه|مكان واحداث كل جزء|اماكن الاجزاء)/,
      /\b(protagonist of each|setting of each|characters across|main character in each)\b/,
    ];
    return patterns.some((p) => p.test(text));
  }

  /**
   * Matches historical sequence, ruler lineage, or exact treaty/battle queries.
   */
  private static matchesHistoricalSequenceOrRuler(text: string): boolean {
    const hasEventTerm = /(معركه|غزوه|معاهده|صلح|حرب|ثوره)/.test(text);
    const hasHistoricalQuery = /(قبل ولا بعد|سنه كام|سنة كام|تاريخها|مين انتصر|مين كان الحاكم|مين حكم|فتره حكم|فترة حكم|سلاله|سلالة|خلفاء|ملوك)/.test(text);
    if (hasEventTerm && hasHistoricalQuery) return true;

    const directPatterns = [
      /(ترتيب ملوك|ترتيب خلفاء|سلاله|سلالة|حكام مصر|فتره حكم|فترة حكم|تسلسل حكام)/,
      /\b(lineage of|rulers of|battle of|treaty of|who won the battle of)\b/,
    ];
    return directPatterns.some((p) => p.test(text));
  }

  /**
   * Matches exact technical version, benchmark, or detailed chipset specs.
   */
  private static matchesTechnicalVersionOrBenchmark(text: string): boolean {
    const patterns = [
      /(سجل التغييرات|تحديث رقم|changelog|release notes|geekbench|antutu score)/,
      /\b(benchmarks? for|changelog for|release notes for)\b/,
    ];
    return patterns.some((p) => p.test(text));
  }

  /**
   * Matches single-hop foundational facts that should NEVER trigger forced precision search.
   * e.g., "مين مؤسس Apple؟", "عاصمة فرنسا", "ما هو Flutter؟"
   */
  private static isSingleHopFoundationalFact(text: string): boolean {
    const patterns = [
      // Founder single queries
      /^(مين\s+(هو\s+)?(مؤسس|موسس|صاحب|انشا|اسس)\s+[\w\u0600-\u06FF\s]+)[؟?!.\s]*$/i,
      /^(who\s+founded|who\s+is\s+the\s+founder\s+of)\s+[\w\s]+[?!\.\s]*$/i,

      // Capital of country
      /^(ما\s+هي\s+عاصم[ةه]\s+[\w\u0600-\u06FF\s]+|ايه\s+عاصم[ةه]\s+[\w\u0600-\u06FF\s]+|عاصم[ةه]\s+[\w\u0600-\u06FF\s]+)[؟?!.\s]*$/i,
      /^(what\s+is\s+the\s+capital\s+of)\s+[\w\s]+[?!\.\s]*$/i,

      // Basic definition of a single concept or tech
      /^(ما\s+هو\s+[\w\u0600-\u06FF\s]{2,30}|ايه\s+هو\s+[\w\u0600-\u06FF\s]{2,30}|يعني\s+ايه\s+[\w\u0600-\u06FF\s]{2,30})[؟?!.\s]*$/i,
      /^(what\s+is\s+[\w\s]{2,30})[?!\.\s]*$/i,
    ];
    return patterns.some((p) => p.test(text));
  }
}
