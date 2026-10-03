/**
 * Tool Result Formatter (Phase 8.2)
 *
 * Extracts tool-specific presentation, prompt synthesis, and confirmation
 * notices out of ExecutionStage into a dedicated presentation layer.
 */

import { LanguageContext } from '../../language/types';
import { parseDueAt } from '../../../database/repositories/reminder.repo';
import { SearchFallbackFormatter } from './search_fallback_formatter';

import { SearchPresentationPolicy } from '../search/search_presentation_policy';

export class ToolResultFormatter {
  /**
   * Formats the prompt notice displayed to the user when a sensitive tool requires confirmation.
   * Note: The internal confirmation token is NEVER rendered in user-facing text.
   */
  public static formatConfirmationNotice(
    toolName: string,
    args: Record<string, any>,
    confirmationToken: string,
    languageContext?: LanguageContext
  ): string {
    const isEnglish = languageContext?.targetLanguage === 'en';
    let promptDetails = '';

    if (toolName === 'create_reminder') {
      const parsedTime = parseDueAt(args.time);
      const recurrence = args.recurrence || 'none';
      let formattedTime = args.time || (isEnglish ? 'Soon' : 'قريباً');

      if (parsedTime) {
        formattedTime = new Intl.DateTimeFormat(
          languageContext?.locale || (isEnglish ? 'en-US' : 'ar-EG-u-nu-latn'),
          {
            timeZone: 'Africa/Cairo',
            hour: 'numeric',
            minute: 'numeric',
            day: 'numeric',
            month: 'long',
          }
        ).format(parsedTime);
      }

      const recurrenceLabel = isEnglish
        ? (recurrence === 'daily'
            ? ' | Recurrence: Daily 🔄'
            : recurrence === 'weekly'
            ? ' | Recurrence: Weekly 🔄'
            : recurrence === 'monthly'
            ? ' | Recurrence: Monthly 🔄'
            : '')
        : (recurrence === 'daily'
            ? ' | التكرار: يومياً (كل يوم) 🔄'
            : recurrence === 'weekly'
            ? ' | التكرار: أسبوعياً 🔄'
            : recurrence === 'monthly'
            ? ' | التكرار: شهرياً 🔄'
            : '');

      promptDetails = isEnglish
        ? `Title: "${args.title || 'Untitled'}" | Time: ${formattedTime}${recurrenceLabel}`
        : `الموضوع: "${args.title || 'بدون عنوان'}" | الموعد: ${formattedTime}${recurrenceLabel}`;
    } else {
      const INTERNAL_KEYS = new Set([
        'token', 'confirmationtoken', 'internalid', 'id', 'uuid', 'secret',
        'key', 'apikey', 'userid', 'conversationid', 'agentrunid', '_score', 'timestamp'
      ]);
      const safeEntries = Object.entries(args || {}).filter(
        ([k, v]) => !INTERNAL_KEYS.has(k.toLowerCase()) && v !== undefined && v !== null
      );
      promptDetails = safeEntries.length > 0
        ? safeEntries.map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' | ')
        : (isEnglish ? 'Standard operation' : 'إجراء قياسي');
    }

    const actionLabel = toolName === 'create_reminder'
      ? (isEnglish ? 'Create new reminder' : 'إنشاء تذكير جديد')
      : toolName;

    return isEnglish
      ? `This action requires your confirmation to proceed:
- Action: ${actionLabel}
- Details: ${promptDetails}`
      : `هذا الإجراء يتطلب تأكيدك الصريح للمتابعة:
- العملية: ${actionLabel}
- التفاصيل: ${promptDetails}`;
  }

  /**
   * Formats raw search execution results into a clean, deterministic WhatsApp fallback response.
   */
  public static formatDeterministicSearchFallback(
    rawResult: any,
    languageContext?: LanguageContext
  ): string {
    return SearchFallbackFormatter.format(rawResult, languageContext);
  }

  /**
   * Builds the direct synthesis prompt for LLM consumption after tool execution.
   */
  public static buildSynthesisPrompt(
    toolName: string,
    serializedResult: string,
    languageContext?: LanguageContext,
    policy?: SearchPresentationPolicy
  ): string {
    const isEnglish = languageContext?.targetLanguage === 'en';

    if (toolName === 'web_search') {
      const showSources = policy?.shouldShowSources ?? false;
      const showUrls = policy?.shouldShowUrls ?? false;

      const sourceInstructionEn = showSources
        ? `\nNOTE: The user explicitly requested sources or references. Synthesize the direct answer first, and clearly provide the verified sources${showUrls ? ' and direct URLs' : ''} at the end.`
        : `\nCRITICAL PRESENTATION REQUIREMENT: The search results above are internal research evidence for you to synthesize your answer. Answer the user's question directly and naturally in your own words. NEVER reproduce raw search result listings, never dump URLs or source lists, and never output headers like "Here are the search results". Do NOT include sources or references unless the user explicitly requested them.`;

      const sourceInstructionAr = showSources
        ? `\nملاحظة: المستخدم طلب صراحة معرفة المصادر أو الروابط المرجعية. قم بصياغة الإجابة المباشرة والواضحة أولاً، ثم اذكر في النهاية المصادر المعتمدة بدقة${showUrls ? ' مع الروابط المباشرة' : ''}.`
        : `\nتحذير حاسم وقاطع: نتائج البحث أعلاه هي مواد استرشادية وبحث داخلي لك فقط لتصيغ منها إجابتك. أجب عن سؤال المستخدم بأسلوبك الطبيعي والمباشر. إياك تماماً أن تفرغ أو تسرد قائمة نتائج البحث الخام (مثل 1. كذا 2. كذا)، ولا تضع قائمة روابط أو مصادر للمستخدم لأن المستخدم لم يطلب المصادر، ولا تضع عنوان "إليك نتائج البحث" أو "المصادر".`;

      return isEnglish
        ? `[Live execution results for tool "${toolName}" from trusted sources]:\n${serializedResult}\n\nTask for Craft AI assistant:\nBased on the data and results above, answer my question directly in fluent, natural English with clear, clean formatting.\nState the exact numbers, prices, specifications, and distributor details accurately as found above.\nCRITICAL: Never mention technical terms like "RSS", "search engine", or "the API". Speak authoritatively as a knowledgeable assistant.\nIf citing sources, cite the publisher or domain name directly (e.g. Reuters, The Verge) and NEVER output raw Google News redirect links (news.google.com/rss/articles).\nIf pricing in Egypt is discussed, the official bank exchange rate is ~48 to 50+ EGP per USD; never use obsolete rates.${sourceInstructionEn}`
        : `[نتائج تنفيذ الأداة ${toolName} الحالية من المصادر المعتمدة]:\n${serializedResult}\n\nالمطلوب منك كوكيل ذكي كرافت:\nبناءً على البيانات والنتائج الموثقة أعلاه، أجب عن سؤالي فوراً وبطريقة واضحة ومنظمة ومريحة للعين${languageContext?.dialect === 'egyptian' ? ' باللهجة المصرية الطبيعية والمهنية' : ' باللغة العربية'}.\nاذكر الأرقام والأسعار والمواصفات بالجنيه المصري (EGP) والدولار والموزعين كما وردت أعلاه بكل دقة ووضوح.\nتحذير حاسم: إياك نهائياً أن تذكر كلمات تقنية مثل "RSS" أو "محرك البحث" أو "الـ API" أو "النتائج لم تذكر". وإذا أردت الاستشهاد بمصدر، اذكر اسم الموقع أو مجاله (مثلاً: اليوم السابع، بي تك، تريدلاين، Apple)، ولا تضع أبداً روابط Google News أو روابط التحويل المشوهة (news.google.com/rss/articles). تحدث كخبير تقني مباشر ومطلع على أحدث البيانات السوقية والموزعين.\nسعر الصرف الرسمي في مصر حوالي 48 إلى 50+ جنيه لكل دولار، لا تستخدم أسعار صرف قديمة إطلاقاً.${sourceInstructionAr}`;
    }

    return isEnglish
      ? `[Execution results for tool "${toolName}"]:\n${serializedResult}\n\nAnswer the user's question directly based on these verified tool results.`
      : `[نتائج تنفيذ الأداة "${toolName}"]:\n${serializedResult}\n\nأجب عن سؤال المستخدم مباشرة وبشكل واضح بناءً على نتائج الأداة الموثقة أعلاه.`;
  }
}
