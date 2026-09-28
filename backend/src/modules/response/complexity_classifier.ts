/**
 * Complexity Classifier for Adaptive Response Intelligence (Phase 6)
 *
 * Deterministically grades query complexity into 'simple', 'moderate', or 'complex'
 * based on structural markers, architectural domain depth, and requested operations.
 * Operates purely locally (< 0.2ms) without LLM calls.
 */

import { ResponseComplexity } from './types';

function normalize(text: string): string {
  if (!text) return '';
  return text
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670]/g, '') // remove diacritics
    .replace(/\u0640/g, '') // remove tatweel
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .trim();
}

export class ComplexityClassifier {
  // Complex indicators: High architectural, enterprise, or systems-level engineering
  private static readonly COMPLEX_PATTERNS = [
    /معماري[هة]/i,
    /هيكل[هة]\s+النظام/i,
    /تصميم\s+(?:نظام|معماريه|سيرفرات)/i,
    /microservices/i,
    /system\s+design/i,
    /production[\s-]ready/i,
    /distributed\s+system/i,
    /high\s+availability/i,
    /scalab(?:le|ility)/i,
    /cluster/i,
    /custom\s+memory\s+allocator/i,
    /memory\s+management/i,
    /concurrency\s+model/i,
    /clean\s+architecture/i,
    /domain[\s-]driven/i,
    /ترحيل\s+(?:قاعده|بيانات|نظام)/i,
    /database\s+migration/i,
    /اعاده\s+هيكله/i,
    /large[\s-]scale/i,
    /trade[\s-]offs?/i,
    /مفاضل[هة]/i,
    /معايير\s+اختيار/i,
    /multi[\s-]tenant/i,
  ];

  // Simple indicators: Definitions, single factual lookups, basic syntax
  private static readonly SIMPLE_PATTERNS = [
    /^(?:ما\s+(?:هو|هي)|ماذا\s+يعني|ما\s+معنى|معنى\s+كلمه|يعني\s+ايه)\s+/i,
    /^(?:what\s+is|define|meaning\s+of)\s+/i,
    /^(?:ما\s+هي\s+عاصم[هة]|عاصم[هة]\s+|capital\s+of)\s+/i,
    /^(?:سعر|كام\s+سعر|price\s+of|cost\s+of)\s+/i,
    /^(?:كم\s+عدد|how\s+many|who\s+is|من\s+هو)\s+/i,
    /^(?:الفرق\s+بين\s+\w+\s+و\s+\w+)$/i,
    /^(?:difference\s+between\s+\w+\s+and\s+\w+)$/i,
    /^(?:صباح\s+الخير|مساء\s+الخير|ازيك|عامل\s+ايه|مرحبا|اهلا|سلام|السلام\s+عليكم)$/i,
    /^(?:hello|hi|hey|good\s+morning|good\s+evening)$/i,
    /^(?:شكرا|تسلم|الف\s+شكر|thank\s+you|thanks)$/i,
  ];

  /**
   * Classifies the complexity level of a user query.
   */
  public static classify(query: string): ResponseComplexity {
    const raw = (query || '').trim();
    if (!raw) return 'simple';

    const norm = normalize(raw);

    // 1. Complex check: Multi-constraint or high architectural terminology
    const hasComplexMarker = this.COMPLEX_PATTERNS.some((p) => p.test(norm));
    if (hasComplexMarker) {
      return 'complex';
    }

    // Check for multi-tier stack integration (e.g. mentions 3+ distinct technologies in a design context)
    const techTokens = ['redis', 'postgresql', 'postgres', 'docker', 'kubernetes', 'kafka', 'graphql', 'auth', 'nginx', 'flutter', 'react'];
    const matchedTechs = techTokens.filter((token) => norm.includes(token));
    if (matchedTechs.length >= 3 && (norm.includes('مع') || norm.includes('with') || norm.includes('ربط') || norm.includes('architecture') || norm.includes('تصميم'))) {
      return 'complex';
    }

    // 2. Simple check: Short queries matching pure definitions, single facts, or greetings
    const isUnder15Words = raw.split(/\s+/).length <= 15;
    const hasSimpleMarker = this.SIMPLE_PATTERNS.some((p) => p.test(norm));
    if (isUnder15Words && hasSimpleMarker) {
      return 'simple';
    }

    // Purely casual/greeting short queries
    if (raw.split(/\s+/).length <= 4 && (norm.includes('سلام') || norm.includes('مرحبا') || norm.includes('اهلا') || norm.includes('hi') || norm.includes('hello'))) {
      return 'simple';
    }

    // 3. Conservative default: Standard implementation, how-to, or standard questions are 'moderate'
    return 'moderate';
  }
}
