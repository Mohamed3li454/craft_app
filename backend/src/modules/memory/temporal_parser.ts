/**
 * Temporal Intelligence & State Awareness Parser (Phase 2.4)
 *
 * Deterministic, zero-LLM extractor for temporal states (historical, current, planned, temporary),
 * relative date expressions, continuity resolvers, and temporal ambiguity detection.
 */

import { TemporalState, TemporalMetadata } from './types';

export interface ParsedTemporalIntent {
  readonly temporalState: TemporalState;
  readonly temporalSignal?: string;
  readonly rawTemporalPhrase?: string;
  readonly relativeExpression?: string;
  readonly validFrom: Date | null;
  readonly validUntil: Date | null;
  readonly temporalConfidence: number;
  readonly temporalAmbiguity: boolean;
}

// Relative date patterns
const RELATIVE_EXPRESSION_PATTERNS: Array<{
  regex: RegExp;
  key: string;
}> = [
  { regex: /(?:^|\s)(?:الاسبوع\s+الجاي|الأسبوع\s+الجاي|الاسبوع\s+القادم|الأسبوع\s+القادم)(?:\s|$)|(?:^|\b)next\s+week\b/i, key: 'next_week' },
  { regex: /(?:^|\s)(?:الشهر\s+الجاي|الشهر\s+القادم)(?:\s|$)|(?:^|\b)next\s+month\b/i, key: 'next_month' },
  { regex: /(?:^|\s)(?:النهارده\s+بس|النهاردة\s+بس|اليوم\s+فقط)(?:\s|$)|(?:^|\b)(?:just\s+for\s+today|for\s+today\s+only|today\s+only)\b/i, key: 'today_only' },
  { regex: /(?:^|\s)(?:بكرة|بكرا|غدا|غداً)(?:\s|$)|(?:^|\b)tomorrow\b/i, key: 'tomorrow' },
  { regex: /(?:^|\s)(?:من\s+أسبوع|من\s+اسبوع)(?:\s|$)|(?:^|\b)last\s+week\b/i, key: 'last_week' },
  { regex: /(?:^|\s)(?:من\s+شهر)(?:\s|$)|(?:^|\b)last\s+month\b/i, key: 'last_month' },
  { regex: /(?:^|\s)(?:من\s+كام\s+يوم|من\s+كم\s+يوم)(?:\s|$)|(?:^|\b)a\s+few\s+days\s+ago\b/i, key: 'few_days_ago' },
];

// Temporary signals (ephemeral / transient)
const TEMPORARY_PATTERNS: RegExp[] = [
  /(?:^|\s)النهارده\s+بس(?:\s|$)/i,
  /(?:^|\s)النهاردة\s+بس(?:\s|$)/i,
  /(?:^|\s)اليوم\s+فقط(?:\s|$)/i,
  /(?:^|\s)مؤقتًا(?:\s|$)/i,
  /(?:^|\s)مؤقتا(?:\s|$)/i,
  /(?:^|\s)دلوقتي\s+بس(?:\s|$)/i,
  /(?:^|\s)لفترة\s+قصيرة(?:\s|$)/i,
  /(?:^|\s)مؤقت(?:\s|$)/i,
  /(?:^|\s)(?:أنا\s+|انا\s+)?بجرب(?:\s+بس)?(?:\s|$)/i,
  /\bjust\s+for\s+today\b/i,
  /\bfor\s+today\s+only\b/i,
  /\btemporarily\b/i,
  /\bfor\s+now\b/i,
  /\bfor\s+a\s+short\s+time\b/i,
  /\bjust\s+testing\b/i,
  /\bjust\s+trying\b/i,
  /\btesting\s+out\b/i,
];

// Planned / Future signals
const PLANNED_PATTERNS: RegExp[] = [
  /(?:^|\s)هبدأ(?:\s|$)/i,
  /(?:^|\s)سأبدأ(?:\s|$)/i,
  /(?:^|\s)هشتغل(?:\s|$)/i,
  /(?:^|\s)سأعمل(?:\s|$)/i,
  /(?:^|\s)هتعلم(?:\s|$)/i,
  /(?:^|\s)سأتعلم(?:\s|$)/i,
  /(?:^|\s)ناوي(?:\s|$)/i,
  /(?:^|\s)مخطط(?:\s|$)/i,
  /(?:^|\s)بعدين(?:\s|$)/i,
  /(?:^|\s)الأسبوع\s+الجاي(?:\s|$)/i,
  /(?:^|\s)الاسبوع\s+الجاي(?:\s|$)/i,
  /(?:^|\s)الشهر\s+الجاي(?:\s|$)/i,
  /(?:^|\s)في\s+المستقبل(?:\s|$)/i,
  /(?:^|\s)سوف\s+أبدأ(?:\s|$)/i,
  /(?:^|\s)سوف\s+ابدأ(?:\s|$)/i,
  /(?:^|\s)سوف\s+أعمل(?:\s|$)/i,
  /(?:^|\s)سوف\s+اعمل(?:\s|$)/i,
  /\bnext\s+week\b/i,
  /\bnext\s+month\b/i,
  /\bplanning\s+to\b/i,
  /\bplan\s+to\b/i,
  /\bi\s+will\b/i,
  /\bi['’]?m\s+going\s+to\b/i,
  /\bgoing\s+to\s+learn\b/i,
  /\bwill\s+start\b/i,
  /\bwill\s+work\s+on\b/i,
  /\bin\s+the\s+future\b/i,
];

// Historical signals (past events)
const HISTORICAL_PATTERNS: RegExp[] = [
  /(?:^|\s)زمان(?:\s|$)/i,
  /(?:^|\s)قبل\s+كده(?:\s|$)/i,
  /(?:^|\s)قبل\s+كدة(?:\s|$)/i,
  /(?:^|\s)سابقًا(?:\s|$)/i,
  /(?:^|\s)سابقا(?:\s|$)/i,
  /(?:^|\s)في\s+الماضي(?:\s|$)/i,
  /(?:^|\s)كنت\s+بستخدم(?:\s|$)/i,
  /(?:^|\s)كنت\s+شغال(?:\s|$)/i,
  /(?:^|\s)كنت\s+أعمل(?:\s|$)/i,
  /(?:^|\s)كنت\s+اعمل(?:\s|$)/i,
  /(?:^|\s)زمان\s+كنت(?:\s|$)/i,
  /(?:^|\s)سبق\s+لي(?:\s|$)/i,
  /(?:^|\s)كنت(?:\s|$)/i,
  /\bused\s+to\b/i,
  /\bformerly\b/i,
  /\bpreviously\b/i,
  /\bback\s+then\b/i,
  /\bin\s+the\s+past\b/i,
  /\bi\s+used\s+to\s+work\s+with\b/i,
  /\bused\s+to\s+use\b/i,
  /\bwas\s+working\s+with\b/i,
  /\bhad\s+worked\s+with\b/i,
  /(?:^|\s)لم\s+أعد\s+(?:أستخدم|استخدم|أعمل|اعمل|شغال)/i,
  /(?:^|\s)لم\s+اعد\s+(?:أستخدم|استخدم|أعمل|اعمل|شغال)/i,
  /(?:^|\s)بطلت\s+(?:أستخدم|استخدم|أشتغل|اشتغل)/i,
  /(?:^|\s)(?:سبت|سيبت|تركت)\s+/i,
  /\bno\s+longer\s+use\b/i,
  /\bstopped\s+using\b/i,
  /\bleft\s+(?:the\s+)?company\b/i,
];

// Present continuity signals (resolves past mentions that are still ongoing)
const CONTINUITY_PATTERNS: RegExp[] = [
  /(?:^|\s)لسه\s+بستخدم/i,
  /(?:^|\s)لسه\s+شغال/i,
  /(?:^|\s)ما\s*زلت\s+بستخدم/i,
  /(?:^|\s)ما\s*زلت\s+شغال/i,
  /(?:^|\s)ولسه\s+بستخدم/i,
  /(?:^|\s)ولسه\s+شغال/i,
  /(?:^|\s)لسه\s+مع/i,
  /(?:^|\s)حتى\s+الآن/i,
  /(?:^|\s)حتى\s+الان/i,
  /\bstill\s+use\b/i,
  /\bstill\s+using\b/i,
  /\bstill\s+work\b/i,
  /\bstill\s+working\b/i,
  /\beven\s+now\b/i,
  /\band\s+still\b/i,
];

// Current signals
const CURRENT_PATTERNS: RegExp[] = [
  /(?:^|\s)دلوقتي(?:\s|$)/i,
  /(?:^|\s)حاليًا(?:\s|$)/i,
  /(?:^|\s)حاليا(?:\s|$)/i,
  /(?:^|\s)الآن(?:\s|$)/i,
  /(?:^|\s)الان(?:\s|$)/i,
  /(?:^|\s)(?:أنا|انا)\s+بستخدم(?:\s|$)/i,
  /(?:^|\s)(?:أنا|انا)\s+شغال(?:\s|$)/i,
  /(?:^|\s)شغال\s+على(?:\s|$)/i,
  /(?:^|\s)(?:حاليًا|حاليا)\s+بدرس(?:\s|$)/i,
  /(?:^|\s)بشتغل(?:\s|$)/i,
  /\bcurrently\b/i,
  /\bright\s+now\b/i,
  /\bat\s+the\s+moment\b/i,
  /\bi\s+use\b/i,
  /\bi\s+am\s+using\b/i,
  /\bi['’]?m\s+working\s+on\b/i,
  /\bworking\s+on\b/i,
  /\bpresently\b/i,
];

/**
 * Deterministically extracts temporal state and metadata from user message text.
 */
export function parseTemporalIntent(text: string): ParsedTemporalIntent {
  if (!text || typeof text !== 'string') {
    return {
      temporalState: 'unknown',
      validFrom: null,
      validUntil: null,
      temporalConfidence: 0.50,
      temporalAmbiguity: false,
    };
  }

  const clean = text.trim();
  const lower = clean.toLowerCase();

  // 1. Detect relative expressions
  let relativeExpression: string | undefined;
  for (const rel of RELATIVE_EXPRESSION_PATTERNS) {
    if (rel.regex.test(clean)) {
      relativeExpression = rel.key;
      break;
    }
  }

  // 2. Check signals
  const hasContinuity = CONTINUITY_PATTERNS.some((p) => p.test(clean));
  const hasTemporary = TEMPORARY_PATTERNS.some((p) => p.test(clean));
  const hasPlanned = PLANNED_PATTERNS.some((p) => p.test(clean));
  const hasHistorical = HISTORICAL_PATTERNS.some((p) => p.test(clean));
  const hasCurrent = CURRENT_PATTERNS.some((p) => p.test(clean));

  // 3. Continuity resolution:
  // e.g., "كنت بستخدم Flutter زمان ولسه بستخدمه دلوقتي" -> CURRENT!
  if (hasHistorical && hasContinuity) {
    return {
      temporalState: 'current',
      temporalSignal: 'continuity_resolved',
      rawTemporalPhrase: 'historical_with_present_continuity',
      relativeExpression,
      validFrom: null,
      validUntil: null,
      temporalConfidence: 0.90,
      temporalAmbiguity: false,
    };
  }

  // 4. Temporary intent (transient / ephemeral context)
  if (hasTemporary) {
    let validUntil: Date | null = null;
    if (relativeExpression === 'today_only' || clean.includes('النهارده بس') || lower.includes('just for today')) {
      // 24-hour expiration for today-only tasks
      validUntil = new Date(Date.now() + 24 * 60 * 60 * 1000);
    }
    return {
      temporalState: 'temporary',
      temporalSignal: 'ephemeral_routine',
      rawTemporalPhrase: relativeExpression || 'temporary_signal',
      relativeExpression,
      validFrom: null,
      validUntil,
      temporalConfidence: 0.92,
      temporalAmbiguity: false,
    };
  }

  // 5. Conflicting signals without resolution (Ambiguity)
  // e.g. "زمان هبدأ مشروع جديد"
  if (hasHistorical && hasPlanned && !hasContinuity) {
    return {
      temporalState: 'unknown',
      temporalSignal: 'conflicting_temporal_signals',
      rawTemporalPhrase: 'past_and_future_collision',
      relativeExpression,
      validFrom: null,
      validUntil: null,
      temporalConfidence: 0.30,
      temporalAmbiguity: true,
    };
  }

  // 6. Planned intent (future goals / intentions)
  if (hasPlanned && !hasHistorical) {
    return {
      temporalState: 'planned',
      temporalSignal: 'future_intention',
      rawTemporalPhrase: relativeExpression || 'planned_signal',
      relativeExpression,
      validFrom: null,
      validUntil: null,
      temporalConfidence: 0.88,
      temporalAmbiguity: false,
    };
  }

  // 7. Historical intent (past tools, previous companies, previous experience)
  // NOTE: Historical memories are NEVER expired (validUntil is strictly null)
  if (hasHistorical && !hasCurrent) {
    return {
      temporalState: 'historical',
      temporalSignal: 'past_experience',
      rawTemporalPhrase: 'historical_marker',
      relativeExpression,
      validFrom: null,
      validUntil: null, // Historical is a permanent fact of user history!
      temporalConfidence: 0.92,
      temporalAmbiguity: false,
    };
  }

  // 8. Explicit Current intent
  if (hasCurrent) {
    return {
      temporalState: 'current',
      temporalSignal: 'current_active',
      rawTemporalPhrase: 'present_marker',
      relativeExpression,
      validFrom: null,
      validUntil: null,
      temporalConfidence: 0.95,
      temporalAmbiguity: false,
    };
  }

  // 9. Default / Atemporal / General fact
  return {
    temporalState: 'unknown',
    temporalSignal: 'atemporal_default',
    relativeExpression,
    validFrom: null,
    validUntil: null,
    temporalConfidence: 0.50,
    temporalAmbiguity: false,
  };
}
