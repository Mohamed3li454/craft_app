/**
 * Natural Response Guard (Phase 15.1F)
 *
 * Enforces natural, authentic, and direct conversational openings:
 * - Eliminates robotic meta-preambles ("أنا Craft – إليك النسخة المصححة...", "بصفتي Craft...", "كـ AI...")
 * - Prevents internal engineering/processing jargon ("قمت بالبحث في...", "الـ API رجع...", "بناءً على نتائج البحث...")
 * - Provides both prompt-level directives and deterministic code-level post-sanitization.
 * - Preserves authentic identity disclosures when user explicitly asks ("مين أنت؟", "Who are you?").
 */

import { LanguageContext } from '../language/types';

export class NaturalResponseGuard {
  /**
   * Builds prompt directives enforcing direct, natural conversational openings.
   */
  public static buildDirectives(languageContext?: LanguageContext): string {
    const isEnglish = languageContext?.targetLanguage === 'en';

    if (isEnglish) {
      return `### Natural Response & Anti-Robotic Preamble Guard:
- STRICT PROHIBITION ON META-PREAMBLES:
  * NEVER begin your response with robotic introductions like "I am Craft...", "As Craft...", "Here is the corrected version...", "As an AI assistant...".
  * NEVER explain your internal execution steps, reasoning stages, or tool mechanics (e.g. do NOT say: "I searched the web for...", "Based on the search results...", "The API returned...").
  * Answer directly, naturally, and warmly. If correcting a previous error, provide the corrected facts immediately without robotic disclaimers.`;
    }

    return `### Natural Response & Anti-Robotic Preamble Guard:
- حظر المقدمات الآلية المصطنعة (STRICT PROHIBITION):
  * إياك تماماً والبدء بمقدمات آلية مثل: "أنا Craft...", "أنا كرافت...", "إليك النسخة المصححة...", "بصفتي Craft...", "كـ AI مساعد...", "بصفتي المساعد الذكي...".
  * إياك وسرد خطوات عملك الداخلية أو شرح آليات البحث (مثل: "قمت بالبحث في المصادر...", "بناءً على نتائج البحث...", "بعد مراجعة السجلات...", "الـ API رجع...").
  * أجب فوراً بأسلوب مصري طبيعي ومباشر. وإذا كنت تصحح معلومة سابقة، قدم المعلومات الصحيحة فوراً وبكل بساطة دون ديباجة واعتذارات آلية طويلة.`;
  }

  /**
   * Deterministically cleans robotic preambles and internal execution disclosures from model output.
   */
  public static cleanResponsePreamble(responseText: string, userGoal?: string): string {
    if (!responseText || typeof responseText !== 'string') {
      return responseText || '';
    }

    const trimmed = responseText.trim();
    if (trimmed.length === 0) {
      return trimmed;
    }

    // If user explicitly asks who Craft is, preserve natural identity answer
    if (userGoal && this.isExplicitIdentityQuery(userGoal)) {
      return trimmed;
    }

    let cleaned = trimmed;

    // 1. Strip robotic identity preambles (Arabic & English)
    const preamblePatterns = [
      // "أنا Craft – إليك النسخة المصححة..." or "أنا كرافت..."
      /^(أنا\s+(كرافت|craft)(\s*[-–—:]|\s+المساعد\s+الذكي)?\s*(إليك\s+(النسخة\s+المصححة|الإجابة\s+المصححة|التصحيح|الترتيب\s+المصحح))?(\s*[-–—:]|\s+كاملة)?\s*)/i,
      // "إليك النسخة المصححة:" or "إليك الترتيب المصحح:"
      /^(إليك\s+(النسخة\s+المصححة|الإجابة\s+المصححة|التصحيح|الترتيب\s+المصحح|الترتيب\s+الصحيح)(\s*[-–—:]|\s+كاملة)?\s*)/i,
      // "بصفتي Craft..."
      /^(بصفتي\s+(كرافت|craft|المساعد\s+الذكي)\s*[-–—:]?\s*)/i,
      // "كـ AI مساعد..." or "كـ مساعد ذكي..."
      /^(كـ\s*(ai\s*مساعد|مساعد\s*ذكي|ai|مساعد)[،,]?\s*(إليك\s+)?)/i,
      // English: "I am Craft...", "As Craft...", "Here is the corrected version..."
      /^(i\s+am\s+craft\s*[-–—:]?\s*(here\s+is\s+the\s+corrected\s+version)?\s*[-–—:]?\s*)/i,
      /^(as\s+craft,\s*(here\s+is\s+the\s+corrected\s+version)?\s*[-–—:]?\s*)/i,
      /^(here\s+is\s+the\s+corrected\s+version\s*[-–—:]?\s*)/i,
      /^(as\s+an\s+ai\s+assistant\s*[-–—:]?\s*)/i,
      // Internal execution steps: "بعد البحث في المصادر...", "بناءً على نتائج البحث..."
      /^(بعد\s+(البحث\s+في\s+(المصادر\s+المعتمدة|المصادر|النتائج)|مراجعة\s+(المصادر\s+المعتمدة|المصادر)|التحقق\s+من\s+(المصادر\s+المعتمدة|المصادر)|البحث)\s*[-–—:,]?\s*)/i,
      /^(بناءً\s+على\s+(نتائج\s+البحث\s+في\s+المصادر|نتائج\s+البحث|المصادر\s+المعتمدة|ما\s+تم\s+البحث\s+عنه)\s*[-–—:,]?\s*)/i,
      /^(based\s+on\s+(the\s+search\s+results|my\s+search|the\s+sources)\s*[-–—:,]?\s*)/i,
    ];

    let matched = true;
    while (matched) {
      matched = false;
      for (const pattern of preamblePatterns) {
        if (pattern.test(cleaned)) {
          cleaned = cleaned.replace(pattern, '').trim();
          matched = true;
        }
      }
    }

    // Clean any leading dashes, colons, or bullet punctuation left over
    cleaned = cleaned.replace(/^[-–—:\s]+/, '').trim();

    return cleaned || trimmed;
  }

  /**
   * Checks if user explicitly asked for identity or self-introduction.
   */
  public static isExplicitIdentityQuery(text: string): boolean {
    const normalized = text
      .toLowerCase()
      .replace(/[أإآ]/g, 'ا')
      .replace(/ة/g, 'ه')
      .replace(/ى/g, 'ي')
      .replace(/[؟?!\.,]/g, '')
      .trim();

    const identityPatterns = [
      /^(هو\s+|طب\s+|طيب\s+|قولي\s+)?(مين انت|انت مين|عرف نفسك|انت ايه|ما هو اسمك|اسمك ايه|مين كرافت|من انت)$/,
      /^(who are you|what are you|what is your name|who is craft|what is craft|introduce yourself)(\s+exactly)?$/,
    ];

    return identityPatterns.some((p) => p.test(normalized));
  }
}
