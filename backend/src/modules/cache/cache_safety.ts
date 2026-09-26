import { CacheContext, CacheSafetyCheckResult } from './cache.types';
import { normalizeMessage } from './text_normalizer';

/**
 * Multi-Tier Conservative Safety Architecture (Zero LLM, Sub-millisecond).
 *
 * Any query exhibiting temporal volatility, real-time search dependencies,
 * user-specific state, or imperative tool execution is intercepted BEFORE
 * both Exact Cache and Semantic Cache, and routed directly to the AI Router.
 */

// Tier 1: Current Time & Date patterns (Arabic & English)
const TIME_DATE_PATTERNS = [
  /الساع[ةه]\s*كام/,
  /كام\s*الساع[ةه]/,
  /الوقت\s*(كام|ايه|الحالي|دلوقتي|الان)/,
  /تاريخ\s*(اليوم|النهارده|كام)/,
  /النهارده\s*(كام|ايه|يوم ايه)/,
  /يوم\s*ايه\s*(النهارده|اليوم)/,
  /الساع[ةه]\s*(دلوقتي|الان|حاليا)/,
  /\bwhat\s*time\b/i,
  /\bwhat\s*is\s*the\s*time\b/i,
  /\btime\s*is\s*it\b/i,
  /\bcurrent\s*time\b/i,
  /\bwhat\s*date\b/i,
  /\btoday('?s)?\s*date\b/i,
  /\bwhat\s*day\s*is\s*(it|today)\b/i,
];

// Tier 2: Real-time Market Prices, Currencies, Gold, Exchange Rates
const MARKET_PRICE_PATTERNS = [
  // Arabic currency & gold price queries (including dialectal variations)
  /سعر\s*(الدولار|الذهب|اليورو|الريال|الدرهم|الجنيه|العمل[ةه]|العملات|الفضه|الفضة|الحديد|الاسمنت|البنزين|السولار)/,
  /اسعار\s*(الدولار|الذهب|اليورو|الريال|العملات|البورص[ةه]|الاسهم)/,
  /(الدولار|الذهب|اليورو|الريال)\s*(عامل\s*كام|بكام|وصل\s*كام|سعر[وه]\s*كام|النهارده|اليوم|دلوقتي|الحالي)/,
  /كام\s*سعر\s*(الدولار|الذهب|اليورو|العمل[ةه])/,
  /بكام\s*(الدولار|الذهب|اليورو)/,
  // English currency & exchange rate queries
  /\b(exchange\s*rate|currency\s*rate|dollar\s*rate|gold\s*rate)\b/i,
  /\b(current\s*exchange\s*rate|exchange\s*rate\s*today)\b/i,
  /\bhow\s*much\s*is\s*the\s*(dollar|gold|euro|pound|bitcoin|btc)\b/i,
  /\b(dollar|gold|crypto|stock)\s*price\b/i,
  /\bprice\s*of\s*(dollar|gold|bitcoin|btc|oil)\b/i,
  /\bcurrent\s*(dollar|gold|stock|currency)\s*price\b/i,
];

// Tier 3: Weather, Atmospheric Conditions & Forecasts
const WEATHER_PATTERNS = [
  /الطقس/,
  /درج[ةه]\s*الحرار[ةه]/,
  /الجو\s*(عامل\s*ايه|ايه|اخبار[وه]|النهارده|اليوم|دلوقتي|بكره|غدا|في\s*مصر|في\s*القاهر[ةه]|في\s*اسكندري[ةه])/,
  /حالة\s*الطقس/,
  /توقعات\s*الطقس/,
  /في\s*مطر\s*(النهارده|بكره)?/,
  /\bweather\b/i,
  /\bforecast\b/i,
  /\btemperature\b/i,
  /\bwhat('?s|\s*is)\s*the\s*weather\b/i,
  /\bhow('?s|\s*is)\s*the\s*weather\b/i,
  /\bweather\s*like\s*(today|now|right\s*now)\b/i,
];

// Tier 4: Breaking & Real-Time News
const NEWS_PATTERNS = [
  /(اخر|آخر|احدث|أحدث|اهم|أهم|جميع)\s*(ال)?اخبار/,
  /اخبار\s*.*(اليوم|النهارده|دلوقتي|الحالي[ةه]|العالم|مصر)/,
  /\b(latest|breaking|today('?s)?)\s*news\b/i,
  /\bnews\s*(today|now|right\s*now)\b/i,
];

// Tier 5: User-Specific Personal State, Reminders, Memory, Orders, Accounts
const USER_SPECIFIC_PATTERNS = [
  /فكرني/,
  /ذكرني/,
  /نبهني/,
  /تذكيرات(ي|نا)/,
  /تذكير(ي|نا)/,
  /مواعيد(ي|نا)/,
  /ميعاد(ي|نا)/,
  /جدول\s*مواعيد/,
  /احفظ\s*ان(ي|نا)/,
  /سجل\s*ان(ي|نا)/,
  /رصيد(ي|نا|ك)/,
  /بيانات(ي|نا|ك)/,
  /معلومات(ي|نا|ك)/,
  /حساب(ي|نا|ك)/,
  /ايميل(ي|نا|ك)/,
  /طلب(ي|نا|ك)/,
  /حالة\s*طلب(ي|نا|ك)/,
  /رقم\s*(الطلب|الاوردر)/,
  /(ال)?اوردر(ي|نا|ك)?/,
  /حالة\s*(ال)?اوردر/,
  /شحنت(ي|نا|ك)/,
  /حالة\s*شحنت(ي|نا|ك)/,
  /\bremind\s*(me|us)\b/i,
  /\bmy\s*(reminder|reminders|appointment|appointments|schedule)\b/i,
  /\b(save|remember)\s*that\s*i\b/i,
  /\bmy\s*(order|orders|shipment|shipments|package|delivery)\b/i,
  /\b(status\s*of\s*my\s*order|track\s*my\s*order)\b/i,
  /\bmy\s*(account|profile|balance|email|data)\b/i,
];

// Tier 6: Explicit Imperative Tool Execution Commands
const TOOL_COMMAND_PATTERNS = [
  /احسبلي/,
  /ترجملي/,
  /ابحثلي\s*عن/,
  /\bcalculate\b/i,
  /\btranslate\s*this\b/i,
  /\bsearch\s*(the\s*web|online)\s*for\b/i,
];

/**
 * Evaluates whether an incoming message is safe and eligible for caching.
 * Evaluates against both original raw text and normalized representations.
 * Strictly conservative: if ambiguous and potentially dynamic/user-specific, rejects cache.
 */
export function isCacheEligible(rawText: string, context?: CacheContext): CacheSafetyCheckResult {
  if (!rawText || !rawText.trim()) {
    return { eligible: false, reason: 'empty_query' };
  }

  const { normalized } = normalizeMessage(rawText);

  // 1. Current Time & Date
  for (const pattern of TIME_DATE_PATTERNS) {
    if (pattern.test(rawText) || pattern.test(normalized)) {
      return { eligible: false, reason: 'ineligible_dynamic' };
    }
  }

  // 2. Market Prices & Currencies
  for (const pattern of MARKET_PRICE_PATTERNS) {
    if (pattern.test(rawText) || pattern.test(normalized)) {
      return { eligible: false, reason: 'ineligible_search' };
    }
  }

  // 3. Weather Conditions & Forecasts
  for (const pattern of WEATHER_PATTERNS) {
    if (pattern.test(rawText) || pattern.test(normalized)) {
      return { eligible: false, reason: 'ineligible_search' };
    }
  }

  // 4. Breaking & Live News
  for (const pattern of NEWS_PATTERNS) {
    if (pattern.test(rawText) || pattern.test(normalized)) {
      return { eligible: false, reason: 'ineligible_search' };
    }
  }

  // 5. User-specific Context, Reminders & Personal State
  for (const pattern of USER_SPECIFIC_PATTERNS) {
    if (pattern.test(rawText) || pattern.test(normalized)) {
      return { eligible: false, reason: 'ineligible_user_context' };
    }
  }

  // 6. Explicit Tool Execution Commands
  for (const pattern of TOOL_COMMAND_PATTERNS) {
    if (pattern.test(rawText) || pattern.test(normalized)) {
      return { eligible: false, reason: 'ineligible_tool' };
    }
  }

  return { eligible: true };
}
