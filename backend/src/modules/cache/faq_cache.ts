/**
 * Semantic & Pattern-Based FAQ Cache for Instant 0-Token Zero-Latency Responses.
 * Intercepts common repetitive queries (identity, creator, greetings, thanks, etc.)
 * and answers in <5ms without touching external LLMs.
 */

export interface FAQMatchResult {
  matched: boolean;
  response?: string;
  intent?: string;
}

export function normalizeArabicText(text: string): string {
  if (!text) return '';
  return text
    .toLowerCase()
    .trim()
    // Remove Arabic diacritics / tashkeel
    .replace(/[\u064B-\u065F\u0670]/g, '')
    // Remove tatweel (kashida)
    .replace(/\u0640/g, '')
    // Normalize alef variants
    .replace(/[أإآٱ]/g, 'ا')
    // Normalize taa marbouta
    .replace(/ة/g, 'ه')
    // Normalize yaa variants
    .replace(/[ىي]/g, 'ي')
    // Normalize waw variants
    .replace(/ؤ/g, 'و')
    // Normalize hamza on nabra
    .replace(/ئ/g, 'ي')
    // Remove punctuation, emojis, and special chars
    .replace(/[؟?!.,;:_~#*+\-=\/\\()\[\]{}'"`^%$@!<>|]/g, ' ')
    // Collapse multi-spaces into single space
    .replace(/\s+/g, ' ')
    .trim();
}

export class FAQCache {
  private static instance: FAQCache;

  public static getInstance(): FAQCache {
    if (!FAQCache.instance) {
      FAQCache.instance = new FAQCache();
    }
    return FAQCache.instance;
  }

  /**
   * Checks if an incoming user prompt matches a high-frequency FAQ pattern.
   * Returns instant formatted reply if matched, or { matched: false } if LLM processing is required.
   */
  public match(rawText: string): FAQMatchResult {
    const norm = normalizeArabicText(rawText);
    if (!norm) return { matched: false };

    // 1. Creator & Developer Questions (e.g. مين اللي عملك، مين محمد علي، اسم اللي برمجك)
    const creatorPatterns = [
      'مين اللي عملك',
      'مين عملك',
      'مين برمجك',
      'مين صاحبك',
      'مين اللي عمل الشات',
      'مين اللي عمل الشات ده',
      'مين صنعك',
      'اسم اللي عملك',
      'عايز اسم اللي عملك',
      'عايز اسم الي عملك',
      'مين مطورك',
      'مين اللي طورك',
      'مين عمل هذا البوت',
      'مين صاحب البوت',
      'تعرف حد اسمه محمد علي',
      'تعرف محمد علي',
      'مين محمد علي',
      'مين المطور',
      'من صنعك',
      'من برمجك',
      'من طورك',
      'من مطورك',
      'من هو محمد علي',
    ];
    if (creatorPatterns.some((p) => norm.includes(normalizeArabicText(p)))) {
      return {
        matched: true,
        intent: 'creator',
        response:
          'تم تصميمي وتطويري بالكامل بواسطة المهندس *محمد علي (Mohamed Ali)* وفريق منظومة *Craft* كوكيل ذكي متطور لمساعدتك وإنجاز مهامك اليومية بأعلى كفاءة وسرعة! 🚀✨\n\nتأمرني بأي حاجة يا باشا؟',
      };
    }

    // 2. Identity & Introduction (e.g. انت مين، اسمك ايه، عرفني بنفسك)
    const identityPatterns = [
      'انت مين',
      'عرفني بنفسك',
      'اسمك ايه',
      'ما هو اسمك',
      'انت ايه',
      'بتعمل ايه',
      'مين انت',
      'ما هي وظيفتك',
      'شغال ايه',
      'ما هو كرافت',
      'ايه كرافت ده',
    ];
    if (identityPatterns.some((p) => norm === normalizeArabicText(p) || norm.startsWith(normalizeArabicText(p)))) {
      return {
        matched: true,
        intent: 'identity',
        response:
          'أنا *كرافت (Craft)* ⚡، مساعدك الشخصي الذكي! أقدر أساعدك في كل حاجة: الإجابة على استفساراتك، البحث المباشر في الإنترنت، إدارة وتنظيم تذكيراتك ومواعيدك، وفحص الصور والملفات الصوتية والمستندات بدقة.\n\nقولي يا باشا، أقدر أساعدك بإيه النهاردة؟',
      };
    }

    // 3. Age & Birthday Questions (e.g. عندك كام سنة، سنك كام)
    const agePatterns = [
      'عندك كام سنة',
      'عمرك كام',
      'سنك كام',
      'كم عمرك',
      'تاريخ ميلادك',
      'متى ولدت',
    ];
    if (agePatterns.some((p) => norm.includes(normalizeArabicText(p)))) {
      return {
        matched: true,
        intent: 'age',
        response:
          'أنا ذكاء اصطناعي، ماليش سن أو عمر بالمعنى التقليدي 🤖، دايماً متحدث في أحدث نسخة وجاهز أخدمك على مدار الساعة في أي وقت!',
      };
    }

    // 4. Brief Casual Greetings (Exact match only to not intercept questions starting with greeting)
    const exactGreetings = [
      'ازيك',
      'عامل ايه',
      'اخبارك ايه',
      'اخبارك',
      'صباح الخير',
      'مساء الخير',
      'سلام عليكم',
      'السلام عليكم',
      'سلام',
      'هاي',
      'اهلا',
      'مرحبا',
    ];
    if (exactGreetings.some((g) => norm === normalizeArabicText(g))) {
      return {
        matched: true,
        intent: 'greeting',
        response:
          'يا هلا والله يا باشا! الحمد لله كله تمام وزي الفل، يومك سعيد يا رب. طمني عليك وأنا تحت أمرك فوراً، تحب أساعدك في إيه؟ 😊',
      };
    }

    // 5. Thanks & Gratitude
    const exactThanks = [
      'شكرا',
      'تسلم',
      'الف شكر',
      'حبيبي',
      'تسلم ايدك',
      'شكرا جزيلا',
      'مشكور',
      'الله يخليك',
    ];
    if (exactThanks.some((t) => norm === normalizeArabicText(t))) {
      return {
        matched: true,
        intent: 'thanks',
        response:
          'العفو يا باشا على راسي! أنا في خدمتك دايماً وفي أي وقت، تسلم يا غالي. 🙏✨',
      };
    }

    return { matched: false };
  }
}
