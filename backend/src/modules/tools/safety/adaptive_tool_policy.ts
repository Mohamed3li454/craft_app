/**
 * Adaptive Tool Manifest Policy (Phase 14.3)
 *
 * Implements deterministic, fail-open adaptive tool manifest selection.
 *
 * Operational Modes:
 * - NONE: Pure conversational requests (greetings, thanks, farewells, pleasantries).
 *   Provider request receives `tools: undefined` (saving ~1,180 tokens).
 * - SCOPED: Clear single-domain tool intent (weather, current time, web search, reminders).
 *   Exposes only domain-relevant tools.
 * - FULL: Ambiguous, complex, multi-intent requests, or when prior execution steps exist.
 *   Fails open to all tools permitted by TriggerContract.
 *
 * Hard Safety Boundary:
 * - TriggerContract acts as the authoritative ceiling.
 * - Adaptive Tool Policy can only filter (subset) capability-allowed tools; it CAN NEVER
 *   expand or inject forbidden tools (e.g. for smart_reminder or proactive triggers).
 */

import { AgentTool } from '../contracts/tool.types';
import { PrecisionFactualDetector } from '../../factual';

export type ToolManifestMode = 'NONE' | 'SCOPED' | 'FULL';

export interface AdaptiveToolOptions {
  readonly hasPriorSteps?: boolean;
  readonly priorToolNames?: readonly string[];
  readonly recentMessages?: Array<{ role?: string; senderRole?: string; text?: string; content?: string }>;
}

export interface AdaptiveToolManifestResult {
  readonly mode: ToolManifestMode;
  readonly tools: AgentTool[];
  readonly toolNames: readonly string[];
  readonly reason: string;
}

export class AdaptiveToolPolicy {
  /**
   * Deterministically resolves the adaptive tool manifest based on user query intent,
   * bounded strictly by the pre-filtered capability allowed tools.
   */
  public static resolveAdaptiveTools(
    allowedTools: AgentTool[],
    query?: string,
    triggerType?: string,
    options?: AdaptiveToolOptions
  ): AdaptiveToolManifestResult {
    // 0. Safety Guard: If execution has already progressed past step 0, NEVER return NONE.
    // If prior steps or query clearly indicate a single domain, keep tool manifest SCOPED
    // to avoid token compounding. Otherwise, fail open to FULL.
    if (options?.hasPriorSteps) {
      const rawQuery = (query || '').trim();
      const normQuery = rawQuery ? this.normalizeText(rawQuery) : '';
      const cleanQ = normQuery ? normQuery.replace(/[؟?!\.,\u060C]/g, '').trim() : '';

      const priorTools = options.priorToolNames || [];
      const hasSearchPrior = priorTools.includes('web_search');
      const hasReminderPrior = priorTools.some((t) =>
        ['create_reminder', 'list_reminders', 'complete_reminder'].includes(t)
      );
      const hasWeatherPrior = priorTools.includes('get_weather');
      const hasTimePrior = priorTools.includes('get_current_time');

      // Domain-aware scoping for multi-step runs (saves ~620 tokens per planner call):
      const priorFactualEval = cleanQ ? PrecisionFactualDetector.evaluate(cleanQ) : undefined;
      const isPriorPrecisionFactual = priorFactualEval?.policy === 'PRECISION_FACTUAL';

      if ((hasSearchPrior || (cleanQ && this.isSearchIntent(cleanQ)) || isPriorPrecisionFactual) && !hasReminderPrior) {
        const searchToolNames = ['web_search', 'get_current_time'];
        const searchTools = allowedTools.filter((t) => searchToolNames.includes(t.name));
        if (searchTools.length > 0) {
          return {
            mode: 'SCOPED',
            tools: searchTools,
            toolNames: searchTools.map((t) => t.name),
            reason: isPriorPrecisionFactual
              ? `SCOPED_PRECISION_FACTUAL_PRIOR_STEPS`
              : 'SCOPED_SEARCH_INTENT_PRIOR_STEPS',
          };
        }
      }

      if ((hasReminderPrior || (cleanQ && this.isReminderIntent(cleanQ))) && !hasSearchPrior) {
        const reminderToolNames = ['create_reminder', 'list_reminders', 'complete_reminder', 'get_current_time'];
        const reminderTools = allowedTools.filter((t) => reminderToolNames.includes(t.name));
        if (reminderTools.length > 0) {
          return {
            mode: 'SCOPED',
            tools: reminderTools,
            toolNames: reminderTools.map((t) => t.name),
            reason: 'SCOPED_REMINDER_INTENT_PRIOR_STEPS',
          };
        }
      }

      if ((hasWeatherPrior || (cleanQ && this.isWeatherIntent(cleanQ))) && !hasSearchPrior && !hasReminderPrior) {
        const weatherTools = allowedTools.filter((t) => t.name === 'get_weather');
        if (weatherTools.length > 0) {
          return {
            mode: 'SCOPED',
            tools: weatherTools,
            toolNames: weatherTools.map((t) => t.name),
            reason: 'SCOPED_WEATHER_INTENT_PRIOR_STEPS',
          };
        }
      }

      // Default for prior steps (ambiguous, mixed domains, or generic conversational turns with prior steps)
      return {
        mode: 'FULL',
        tools: allowedTools,
        toolNames: allowedTools.map((t) => t.name),
        reason: 'PRIOR_EXECUTION_STEPS_ACTIVE',
      };
    }

    // 1. Fail-open if query is missing
    const raw = (query || '').trim();
    if (!raw) {
      return {
        mode: 'FULL',
        tools: allowedTools,
        toolNames: allowedTools.map((t) => t.name),
        reason: 'EMPTY_QUERY_FAIL_OPEN',
      };
    }

    const normalized = this.normalizeText(raw);
    const cleanText = normalized.replace(/[؟?!\.,\u060C]/g, '').trim();

    // 2. Pure Conversational Intent Check (NONE)
    // Only applies if the query matches a pure conversational pattern AND has ZERO action/tool indicators
    if (
      !this.hasActionOrToolIndicators(cleanText) &&
      (this.isPureGreeting(cleanText) ||
        this.isPureThanks(cleanText) ||
        this.isPureAcknowledgment(cleanText) ||
        this.isPureFarewell(cleanText))
    ) {
      return {
        mode: 'NONE',
        tools: [],
        toolNames: [],
        reason: 'PURE_CONVERSATIONAL_INTENT',
      };
    }

    // 3. Scoped Intent Checks (SCOPED)
    // A. Weather Intent
    if (this.isWeatherIntent(cleanText)) {
      const weatherTools = allowedTools.filter((t) => t.name === 'get_weather');
      if (weatherTools.length > 0) {
        return {
          mode: 'SCOPED',
          tools: weatherTools,
          toolNames: weatherTools.map((t) => t.name),
          reason: 'SCOPED_WEATHER_INTENT',
        };
      }
    }

    // B. Current Time Intent
    if (this.isCurrentTimeIntent(cleanText)) {
      const timeTools = allowedTools.filter((t) => t.name === 'get_current_time');
      if (timeTools.length > 0) {
        return {
          mode: 'SCOPED',
          tools: timeTools,
          toolNames: timeTools.map((t) => t.name),
          reason: 'SCOPED_TIME_INTENT',
        };
      }
    }

    // C. Reminder Intent
    if (this.isReminderIntent(cleanText)) {
      const reminderToolNames = ['create_reminder', 'list_reminders', 'complete_reminder', 'get_current_time'];
      const reminderTools = allowedTools.filter((t) => reminderToolNames.includes(t.name));
      if (reminderTools.length > 0) {
        return {
          mode: 'SCOPED',
          tools: reminderTools,
          toolNames: reminderTools.map((t) => t.name),
          reason: 'SCOPED_REMINDER_INTENT',
        };
      }
    }

    // D. Search Intent
    if (this.isSearchIntent(cleanText)) {
      const searchToolNames = ['web_search', 'get_current_time'];
      const searchTools = allowedTools.filter((t) => searchToolNames.includes(t.name));
      if (searchTools.length > 0) {
        return {
          mode: 'SCOPED',
          tools: searchTools,
          toolNames: searchTools.map((t) => t.name),
          reason: 'SCOPED_SEARCH_INTENT',
        };
      }
    }

    // E. Precision Factual Intent (Phase 15.1F)
    const factualEval = PrecisionFactualDetector.evaluate(cleanText);
    if (factualEval.policy === 'PRECISION_FACTUAL') {
      const searchToolNames = ['web_search', 'get_current_time'];
      const searchTools = allowedTools.filter((t) => searchToolNames.includes(t.name));
      if (searchTools.length > 0) {
        return {
          mode: 'SCOPED',
          tools: searchTools,
          toolNames: searchTools.map((t) => t.name),
          reason: `SCOPED_PRECISION_FACTUAL_${factualEval.category || 'INTENT'}`,
        };
      }
    }

    // 4. Default Fail-Open (FULL)
    return {
      mode: 'FULL',
      tools: allowedTools,
      toolNames: allowedTools.map((t) => t.name),
      reason: 'FAIL_OPEN_FULL_MANIFEST',
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

  private static isPureGreeting(text: string): boolean {
    const patterns = [
      /^(ازيك|عامل ايه|عامل اي|اخبارك|اخبارك ايه|صباح الخير|صباح النور|مساء الخير|مساء النور|سلام عليكم|السلام عليكم|مرحبا|اهلا|اهلين|هاي|هالو|الو|يا هلا|اهلا و سهلا|اهلا وسهلا)(\s+(يا\s+)?(كرافت|craft|باشا|فنان|غالي|حبيبي|بطل|bro))?$/,
      /^(ازيك\s+عامل\s+(ايه|اي)|ازيك\s+يا\s+كرافت\s+عامل\s+(ايه|اي)|عامل\s+ايه\s+يا\s+(كرافت|craft|باشا|فنان|غالي|حبيبي|بطل))$/,
      /^(انا\s+)?(كويس|تمام|بخير|الحمد لله)(\s+(الحمد لله|بخير|تمام|كويس))?(\s+(انت\s+)?(عامل ايه|عامل اي|اخبارك|اخبارك ايه|ازيك))?(\s+(يا\s+)?(كرافت|craft|باشا|فنان|غالي))?$/,
      /^(الحمد لله)(\s+(انا\s+)?(كويس|تمام|بخير))?(\s+(انت\s+)?(عامل ايه|عامل اي|اخبارك|اخبارك ايه|ازيك))?(\s+(يا\s+)?(كرافت|craft|باشا|فنان|غالي))?$/,
      /^(كله\s+تمام(\s+الحمد لله)?)(\s+(انت\s+)?(عامل ايه|عامل اي|اخبارك|اخبارك ايه|ازيك))?$/,
      /^(hi|hello|hey|good\s+morning|good\s+evening|good\s+afternoon|howdy)(\s+(craft|bro|there))?$/,
      /^(how\s+are\s+you|how\s+r\s+u|hows\s+it\s+going|whats\s+up)(\s+(craft|bro))?$/,
      /^(im\s+good|im\s+fine|doing\s+well|good)(\s+(how\s+are\s+you|how\s+about\s+you|and\s+you))?$/,
    ];
    return patterns.some((p) => p.test(text));
  }

  private static isPureThanks(text: string): boolean {
    const patterns = [
      /^(شكرا|شكرا\s+جزيلا|شكرا\s+ليك|تمام\s+شكرا|الف\s+شكر|تسلم|الله\s+يخليك|مشكور|مشكور\s+جدا|يعطيك\s+العافيه|يعطيك\s+الف\s+عافيه|تسلم\s+ايدك)(\s+(يا\s+)?(كرافت|craft|باشا|فنان|غالي|حبيبي|سيدي))?$/,
      /^(thanks|thank\s+you|thx|thank\s+you\s+so\s+much|appreciate\s+it)(\s+(craft|bro))?$/,
    ];
    return patterns.some((p) => p.test(text));
  }

  private static isPureAcknowledgment(text: string): boolean {
    const patterns = [
      /^(تمام|ماشي|اوك|اوكي|حلو|كويس|فهمتك|تمام\s+كده|عظيم|حبيبي)(\s+(يا\s+)?(باشا|فنان|غالي|سيدي|كرافت|craft|bro))?$/,
      /^(حلو\s+جدا|عظيم\s+جدا|تمام\s+جدا|تمام\s+يا\s+باشا|ماشي\s+يا\s+باشا|تسلم\s+يا\s+غالي)$/,
      /^(ok|okay|cool|great|got\s+it|understood|nice|perfect)(\s+(craft|bro))?$/,
    ];
    return patterns.some((p) => p.test(text));
  }

  private static isPureFarewell(text: string): boolean {
    const patterns = [
      /^(مع\s+السلامه|باي|تصبح\s+على\s+خير|تصبح\s+علي\s+خير|سلام|اشوفك\s+بعدين|سلام\s+يا\s+صاحبي)(\s+(يا\s+)?(كرافت|craft|باشا|bro))?$/,
      /^(bye|goodbye|good\s+night|see\s+you|see\s+ya)(\s+(craft|bro))?$/,
    ];
    return patterns.some((p) => p.test(text));
  }

  private static hasActionOrToolIndicators(text: string): boolean {
    const patterns = [
      /(فكرني|ذكرني|تذكير|remind)/,
      /(الساعه|الوقت|تاريخ|النهارده كام|clock|\btime\b|\bdate\b)/,
      /(الجو|طقس|حراره|مطر|امطار|\bweather\b|\btemperature\b|\bforecast\b)/,
      /(ابحث|ابحثلي|سيرش|دورلي|سعر|اسعار|مواصفات|تسريبات|\bsearch\b|\bprice\b|\bspecs\b|\bnews\b|(?:^|\s)اخبار(?!\s*ك))/,
      /(احفظ|افتكر|فاكر|\bsave\b|\bremember\b)/,
      /(\bflutter\b|\bdart\b|\bapi\b|\bcode\b|كود|برمجه|ايه الفرق|ازاي|طريقه)/,
      /(ترتيب|رتبلي|تسلسل|اجزاء|سلسله|سلاسل|صححلي|تصحيح|مش صح|غلط|راجعلي)/,
      /(?:^|\s)(اعمل|اعمللي|اعملي|اعملنا|سو|ساوي|نفذ|نفذها|نفذه|نفذلي|طبق|كمل|استمر|قارن|قارنلي|احسب|احسبلي|اكتب|اكتبلي|لخص|لخصلي)(?:\s|$|[^\w\u0600-\u06FF])/,
      /\b(execute|run|do|make|create|calculate|compare|write|summarize|continue)\b/,
    ];
    return patterns.some((p) => p.test(text));
  }

  private static isWeatherIntent(text: string): boolean {
    if (this.isReminderIntent(text)) {
      return false;
    }
    const patterns = [
      /(الجو|الطقس|درجه الحراره|درجات الحراره|حراره|مطر|امطار|شتا|حر)/,
      /\b(weather|temperature|forecast|rain|sunny|hot|cold)\b/,
    ];
    return patterns.some((p) => p.test(text));
  }

  private static isCurrentTimeIntent(text: string): boolean {
    if (this.isReminderIntent(text)) {
      return false;
    }
    const patterns = [
      /(الساعه كام|الساعه كم|الوقت كام|الوقت دلوقتي|الوقت الحالي|تاريخ النهارده|النهارده كام|كام الساعه)/,
      /\b(what time is it|what's the time|current time|what is the time|today's date)\b/,
    ];
    return patterns.some((p) => p.test(text));
  }

  private static isReminderIntent(text: string): boolean {
    const patterns = [
      /(فكرني|ذكرني|اعمل.*تذكير|ابعتلي رساله بعد|تذكير|تذكيرات|مهامي|قائمه المهام)/,
      /\b(remind me|set a reminder|create reminder|my reminders|todo|to-do list)\b/,
    ];
    return patterns.some((p) => p.test(text));
  }

  private static isSearchIntent(text: string): boolean {
    const patterns = [
      /(ابحث|ابحثلي|سيرش|دورلي|ابحث عن|سيرش عن)/,
      /(سعر|اسعار|كام سعر|بكام|مواصفات|تسريبات|اخر اخبار|اخبار|سعر الدولار|سعر الذهب|احدث موديل|مفيش اخبار عن)/,
      /(ليه سموه|ليه اتسمى|سبب تسميه|مين هو|مين هي|ايه هو|ايه هي|ما هو|ما هي|معلومات عن|تفاصيل عن)/,
      /(قارن بين|مقارنه بين|الفرق بين سعر)/,
      /\b(search|search for|lookup|look up|latest news|specs|price of|leaks|compare)\b/,
      /\b(iphone|samsung|xiaomi|pixel|macbook|playstation|xbox|watch dogs|argon|gemini|claude|chatgpt|openai|deepseek|llama|qwen|mistral|grok)\b/,
    ];
    return patterns.some((p) => p.test(text));
  }
}
