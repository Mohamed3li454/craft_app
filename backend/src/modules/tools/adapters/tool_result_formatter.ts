/**
 * Tool Result Formatter (Phase 8.2)
 *
 * Extracts tool-specific presentation, prompt synthesis, and confirmation
 * notices out of ExecutionStage into a dedicated presentation layer.
 */

import { LanguageContext } from '../../language/types';
import { parseDueAt } from '../../../database/repositories/reminder.repo';

export class ToolResultFormatter {
  /**
   * Formats the prompt notice displayed to the user when a sensitive tool requires confirmation.
   */
  public static formatConfirmationNotice(
    toolName: string,
    args: Record<string, any>,
    confirmationToken: string,
    languageContext?: LanguageContext
  ): string {
    const isEnglish = languageContext?.targetLanguage === 'en';
    let promptDetails = JSON.stringify(args);

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
    }

    return isEnglish
      ? `This action requires your confirmation to proceed:
- Action: ${toolName === 'create_reminder' ? 'Create new reminder' : toolName}
- Details: ${promptDetails}
Please confirm using code: ${confirmationToken}`
      : `هذا الإجراء يتطلب تأكيدك الصريح للمتابعة:
- العملية: ${toolName === 'create_reminder' ? 'إنشاء تذكير جديد' : toolName}
- التفاصيل: ${promptDetails}
يرجى التأكيد باستخدام الرمز: ${confirmationToken}`;
  }

  /**
   * Builds the direct synthesis prompt for LLM consumption after tool execution.
   */
  public static buildSynthesisPrompt(
    toolName: string,
    serializedResult: string,
    languageContext?: LanguageContext
  ): string {
    const isEnglish = languageContext?.targetLanguage === 'en';

    if (toolName === 'web_search') {
      return isEnglish
        ? `[Live execution results for tool "${toolName}" from trusted sources]:\n${serializedResult}\n\nTask for Craft AI assistant:\nBased on the data and results above, answer my question directly in fluent, natural English with clear, clean formatting.\nState the exact numbers, prices, specifications, and distributor details accurately as found above.\nCRITICAL: Never mention technical terms like "RSS", "search engine", or "the API". Speak authoritatively as a knowledgeable assistant.\nIf pricing in Egypt is discussed, the official bank exchange rate is ~48 to 50+ EGP per USD; never use obsolete rates.`
        : `[نتائج تنفيذ الأداة ${toolName} الحالية من المصادر المعتمدة]:\n${serializedResult}\n\nالمطلوب منك كوكيل ذكي كرافت:\nبناءً على البيانات والنتائج الموثقة أعلاه، أجب عن سؤالي فوراً وبطريقة واضحة ومنظمة ومريحة للعين${languageContext?.dialect === 'egyptian' ? ' باللهجة المصرية الطبيعية والمهنية' : ' باللغة العربية'}.\nاذكر الأرقام والأسعار والمواصفات بالجنيه المصري (EGP) والدولار والموزعين كما وردت أعلاه بكل دقة ووضوح.\nتحذير حاسم: إياك نهائياً أن تذكر كلمات تقنية مثل "RSS" أو "محرك البحث" أو "الـ API" أو "النتائج لم تذكر". تحدث كخبير تقني مباشر ومطلع على أحدث البيانات السوقية والموزعين.\nسعر الصرف الرسمي في مصر حوالي 48 إلى 50+ جنيه لكل دولار، لا تستخدم أسعار صرف قديمة إطلاقاً.`;
    }

    return isEnglish
      ? `[Execution results for tool "${toolName}"]:\n${serializedResult}\n\nAnswer the user's question directly based on these verified tool results.`
      : `[نتائج تنفيذ الأداة "${toolName}"]:\n${serializedResult}\n\nأجب عن سؤال المستخدم مباشرة وبشكل واضح بناءً على نتائج الأداة الموثقة أعلاه.`;
  }
}
