/**
 * Search Intent Classifier (Phase 9.3)
 *
 * Deterministically classifies search queries into one of 7 intents:
 * - latest_product: Newest devices, gadget specs, prices, leaks, rumors.
 * - breaking_news: Real-time events, current headlines, urgent updates.
 * - technical_release: Software/library releases, stable versions, changelogs, patches.
 * - technical_docs: Official documentation, API references, architecture guides.
 * - historical_fact: Origins, construction dates, founders, historical events.
 * - evergreen_knowledge: Conceptual questions, "how does X work", architectural explanations.
 * - general_web: General lifestyle, local businesses, cultural queries, fallbacks.
 */

import { SearchIntent } from './search.types';
import { LanguageContext } from '../../language/types';

export class SearchIntentClassifier {
  /**
   * Deterministically classifies a query into a SearchIntent.
   */
  public static classify(query: string, languageContext?: LanguageContext): SearchIntent {
    const raw = (query || '').trim();
    if (!raw) return 'general_web';

    const normalized = this.normalizeQuery(raw);

    // 1. Technical Documentation (High specificity)
    if (this.matchesTechnicalDocs(normalized)) {
      return 'technical_docs';
    }

    // 2. Historical Fact (High specificity - precedes evergreen "what is / ما هو")
    if (this.matchesHistoricalFact(normalized)) {
      return 'historical_fact';
    }

    // 3. Technical Release (Software versions, stable releases, changelogs)
    if (this.matchesTechnicalRelease(normalized)) {
      return 'technical_release';
    }

    // 4. Breaking News (Real-time updates, urgent headlines, "أخبار", breaking)
    if (this.matchesBreakingNews(normalized)) {
      return 'breaking_news';
    }

    // 5. Latest Product (Device specs, leaks, gadget prices)
    if (this.matchesLatestProduct(normalized)) {
      return 'latest_product';
    }

    // 6. Evergreen Knowledge ("How does X work", conceptual "what is", difference between)
    if (this.matchesEvergreenKnowledge(normalized)) {
      return 'evergreen_knowledge';
    }

    // 7. General Web default
    return 'general_web';
  }

  private static normalizeQuery(text: string): string {
    return text
      .toLowerCase()
      // Normalize Arabic diacritics
      .replace(/[\u064B-\u065F\u0670]/g, '')
      // Normalize Alef variations
      .replace(/[أإآ]/g, 'ا')
      // Normalize Taa Marbuta / Haa
      .replace(/ة/g, 'ه')
      // Normalize Yaa / Alef Maksura
      .replace(/ى/g, 'ي')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private static matchesTechnicalDocs(q: string): boolean {
    const patterns = [
      /\b(docs|documentation|api reference|sdk reference|api docs|manual|guide|cheatsheet)\b/,
      /\b(official doc|official documentation|developer guide)\b/,
      /(توثيق|الوثائق الرسمية|دليل المطور|دليل الاستخدام|مرجع api|مستندات رسمية)/,
      /(\bdoc\b|\bdocs\b)/,
    ];
    return patterns.some((p) => p.test(q));
  }

  private static matchesHistoricalFact(q: string): boolean {
    const patterns = [
      // Construction, founding, origins
      /(تاريخ بناء|من بني|من بنى|من بناها|متى بني|متى تم بناء|متى تم انشاء|تاريخ انشاء)/,
      /(متى تاسس|تاريخ تاسيس|من اسس|من انشا|متى بدات|متى انتهت|تاريخ نشاه)/,
      /(متى ولد|متى توفي|تاريخ ميلاد|تاريخ وفاة|سنة كام|في اي عام|في اي سنة)/,
      /(حضاره|حضارة|حضارات قديمه|الفراعنه|عصر الفراعنه|الدوله العثمانيه|الحرب العالميه)/,
      /\b(history of|when was|who built|who founded|founded in|built in)\b/,
      /\b(ancient|century bc|century ad|origin of|origins of)\b/,
      // "تاريخ" with historical landmarks or concepts
      /تاريخ\s+(بناء|نشاه|ظهور|اختراع|اكتشاف|تاسيس|الاهرامات|مصر القديمه|روما)/,
    ];
    return patterns.some((p) => p.test(q));
  }

  private static matchesTechnicalRelease(q: string): boolean {
    const patterns = [
      // Explicit release terms
      /(اخر اصدار|احدث اصدار|اصدار مستقر|اصدار جديد|رقم اصدار|نسخه مستقره|نسخة مستقرة)/,
      /(تحديث جديد|تحديث اخير|سجل التغييرات|ملاحظات الاصدار)/,
      /\b(latest release|stable release|release notes|changelog|new version|latest version)\b/,
      /\b(patch notes|version number|stable version)\b/,
      // Framework/tech + version/release
      /\b(flutter|react|angular|vue|node|nodejs|python|rust|golang|dart|swift|kotlin|docker|kubernetes|typescript)\b.*(release|version|update|اصدار|نسخه)/,
      /(اصدار|نسخه).*\b(flutter|react|angular|vue|node|nodejs|python|rust|golang|dart|swift|kotlin|docker|kubernetes|typescript)\b/,
    ];
    return patterns.some((p) => p.test(q));
  }

  private static matchesBreakingNews(q: string): boolean {
    const patterns = [
      /(عاجل|خبر عاجل|اخر اخبار|احدث اخبار|اخبار اليوم|اهم الاخبار|احداث اليوم)/,
      /(حصل ايه|ايه اللي حصل|بيان عاجل|طازه|حصري|النهارده|النهاردة)/,
      /\b(breaking|breaking news|latest news|news today|urgent|just in|headlines)\b/,
      // Query specifically asking for news about a company, country, or event
      /(اخبار|أخبار)\s+([a-zA-Z\u0600-\u06FF]+)/,
    ];
    return patterns.some((p) => p.test(q));
  }

  private static matchesLatestProduct(q: string): boolean {
    const patterns = [
      /(احدث جهاز|احدث هاتف|احدث موبايل|احدث لابتوب|احدث شاشه|احدث سياره)/,
      /(اخر|احدث)\s+(ايفون|iphone|سامسونج|samsung|موبايل|هاتف|تليفون|جهاز)/,
      /(مواصفات|تسريبات|كام سعر|سعر|اسعار|عيوب ومميزات|لسه نازل|مراجعه|ريفيو)/,
      /\b(specs|specifications|price|pricing|leaks|rumors|hands on|review)\b/,
      /\b(latest iphone|latest samsung|latest macbook|latest device|newest phone)\b/,
    ];
    return patterns.some((p) => p.test(q));
  }

  private static matchesEvergreenKnowledge(q: string): boolean {
    const patterns = [
      /(كيف يعمل|كيف تعمل|ما هو|ما هي|ما المقصود ب|مفهوم|طريقه عمل|فكرة عمل)/,
      /(ما الفرق بين|الفرق بين|شرح مبسط|شرح كيف|ازاي بيشتغل|ازاي بتشتغل)/,
      /\b(how does|how do|how to|what is|what are|explain|concept of|difference between|how works)\b/,
      /\b(how it works|why do|why does)\b/,
    ];
    return patterns.some((p) => p.test(q));
  }
}
