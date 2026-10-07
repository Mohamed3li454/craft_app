/**
 * Factual Claim Guard (Phase 15.1F)
 *
 * Enforces strict evidence-bound grounding on external observations:
 * - Search Failure Safety: When a PRECISION_FACTUAL query fails to retrieve
 *   authoritative search results, gracefully states inability to verify exact details
 *   rather than guessing or confabulating from parametric memory.
 * - Evidence-Bound Synthesis Directives: Injects strict directives into final synthesis
 *   requiring every entity, date, character, and setting to be grounded on verified observations.
 * - Conflicting Evidence Preservation: When sources differ, transparently presents the divergence.
 */

import { LanguageContext } from '../language/types';
import {
  FactualClaimValidationResult,
  SearchFailureSafetyResult,
} from './factual_grounding.types';
import { PrecisionFactualDetector } from './precision_factual_detector';

export class FactualClaimGuard {
  /**
   * Evaluates the outcome of search execution for a PRECISION_FACTUAL query.
   * If search failed, timed out, or returned zero meaningful results, returns a graceful
   * Egyptian Arabic or English fallback to prevent parametric confabulation.
   */
  public static evaluateSearchOutcome(
    query: string,
    steps: Array<{ toolName: string; status: string; result?: any; serializedResult?: string }>,
    languageContext?: LanguageContext
  ): SearchFailureSafetyResult {
    const evaluation = PrecisionFactualDetector.evaluate(query);

    // If query is not PRECISION_FACTUAL, standard synthesis handles it
    if (evaluation.policy !== 'PRECISION_FACTUAL') {
      return { shouldFallback: false };
    }

    const searchSteps = steps.filter((s) => s.toolName === 'web_search');

    // 1. If no search step was executed at all
    if (searchSteps.length === 0) {
      return {
        shouldFallback: true,
        reason: 'NO_SEARCH_EXECUTED_FOR_PRECISION_FACTUAL',
        fallbackMessage: this.formatGracefulFailureFallback(evaluation.category, languageContext),
      };
    }

    // 2. If all search steps failed
    const successfulSearches = searchSteps.filter((s) => s.status === 'succeeded');
    if (successfulSearches.length === 0) {
      return {
        shouldFallback: true,
        reason: 'ALL_SEARCH_STEPS_FAILED',
        fallbackMessage: this.formatGracefulFailureFallback(evaluation.category, languageContext),
      };
    }

    // 3. Inspect if search actually returned valid items or empty / error payload
    let hasValidContent = false;
    for (const step of successfulSearches) {
      const res = step.result;
      if (res) {
        if (Array.isArray(res.results) && res.results.length > 0) {
          // Check that results are not just generic error snippet
          const isGenericError =
            res.results.length === 1 &&
            res.results[0]?.title?.includes('نتائج عامة') &&
            !res.results[0]?.snippet;
          if (!isGenericError && !res.error) {
            hasValidContent = true;
            break;
          }
        } else if (typeof res === 'string' && res.length > 50 && !res.includes('"results":[]')) {
          hasValidContent = true;
          break;
        }
      }
      if (step.serializedResult && step.serializedResult.length > 50 && !step.serializedResult.includes('No search results')) {
        hasValidContent = true;
        break;
      }
    }

    if (!hasValidContent) {
      return {
        shouldFallback: true,
        reason: 'ZERO_SEARCH_RESULTS_RETURNED',
        fallbackMessage: this.formatGracefulFailureFallback(evaluation.category, languageContext),
      };
    }

    return { shouldFallback: false };
  }

  /**
   * Builds strict evidence-bound directives for synthesis instructions.
   */
  public static buildEvidenceBoundDirective(
    isPrecisionFactual: boolean,
    languageContext?: LanguageContext
  ): string {
    if (!isPrecisionFactual) {
      return '';
    }

    const isEnglish = languageContext?.targetLanguage === 'en';

    if (isEnglish) {
      return `\nCRITICAL FACTUAL GROUNDING MANDATE:
- This is a high-precision factual response (chronology / multi-entity facts).
- You MUST rely strictly and solely on the verified tool observations above.
- NEVER fabricate names, protagonists, dates, release years, or historical eras that do not appear in the verified observations.
- NEVER mix up real names with fictional substitutions (e.g. if the verified source says Edward Kenway, NEVER say Edward King).
- If any requested entity, release date, or character is missing from the search results, state explicitly that it was not confirmed rather than guessing from parametric memory.`;
    }

    return `\nقواعد التثبت والتوثيق الصارم للحقائق (CRITICAL FACTUAL GROUNDING MANDATE):
- هذا استفسار يتطلب دقة متناهية (ترتيب زمني / شخصيات وأحداث تاريخية / سلاسل متعددة الأجزاء).
- التزم بنسبة 100% بالأسماء والتواريخ والشخصيات الواردة في نتائج البحث الموثقة أعلاه فقط.
- إياك واختلاق أو تخمين أسماء شخصيات أو حكام أو تواريخ غير موجودة في نتائج البحث (على سبيل المثال: إياك وقول "Edward King" أو اختراع شخصيات، والاسم الصحيح هو Edward Kenway إذا ورد في المصادر).
- إذا كان هناك جزء أو شخصية لم تذكرها نتائج البحث الموثقة، قل بوضوح ودون تردد إن المعلومة دي محتاجة بحث منفصل، ولا تخمنها أبداً من الذاكرة.`;
  }

  /**
   * Formats a natural, transparent Egyptian Arabic or English response when precision search cannot verify facts.
   */
  public static formatGracefulFailureFallback(
    category?: string,
    languageContext?: LanguageContext
  ): string {
    const isEnglish = languageContext?.targetLanguage === 'en';
    const isEgyptian = !languageContext || languageContext.dialect === 'egyptian' || languageContext.targetLanguage === 'ar';

    if (isEnglish) {
      if (category === 'CHRONOLOGY_OR_RELEASE_ORDER') {
        return "To be completely accurate and avoid giving you unverified names or dates, I wasn't able to verify the exact chronology from an authoritative source right now. Would you like me to look up a specific title or installment for you?";
      }
      return "To ensure total accuracy and avoid unverified claims, I was unable to confirm the exact details from an authoritative source right now. Would you like me to check a specific point?";
    }

    if (isEgyptian) {
      if (category === 'CHRONOLOGY_OR_RELEASE_ORDER') {
        return 'بص، علشان أكون دقيق معاك تماماً وما أقولكش أي معلومة مش مؤكدة أو أسماء وتواريخ مش مظبوطة، تعذر عليا التحقق من الترتيب الكامل والتفاصيل دي حالياً من مصدر موثوق. تحب نبحث عن جزء معين بالاسم؟';
      }
      if (category === 'FACTUAL_VERIFICATION_OR_CORRECTION') {
        return 'علشان أكون دقيق معاك وما أأكدش أي معلومة بدون مصدر واضح، تعذر عليا مراجعة النقطة دي والتأكد منها بدقة دلوقتي. تحب نبحث عن تفصيلة معينة؟';
      }
      return 'علشان أكون دقيق معاك تماماً وما أقولكش أي معلومة مش مؤكدة، تعذر عليا التحقق من التفاصيل دي حالياً من مصدر موثوق. تحب نبحث عن نقطة محددة؟';
    }

    // Modern Standard Arabic
    return 'حرصاً على تقديم معلومات دقيقة ومؤكدة وتجنب أي تفاصيل غير دقيقة، تعذر التحقق الكامل من المصادر المعتمدة في الوقت الحالي. هل تود البحث عن جزء أو تفصيلة محددة؟';
  }

  /**
   * Verifies that candidate output does not contain known hallucinated entity substitutions.
   */
  public static validateKnownFactualAnomalies(text: string): FactualClaimValidationResult {
    const unverified: string[] = [];
    const lower = text.toLowerCase();

    // Check for "edward king" in Assassin's Creed context
    if (lower.includes('edward king') || lower.includes('ادوارد كينج') || lower.includes('إدوارد كينج')) {
      unverified.push('Edward King (confabulated Assassin\'s Creed entity)');
    }

    return {
      isGrounded: unverified.length === 0,
      unverifiedEntities: unverified,
      warning: unverified.length > 0 ? `Detected confabulated entities: ${unverified.join(', ')}` : undefined,
    };
  }
}
