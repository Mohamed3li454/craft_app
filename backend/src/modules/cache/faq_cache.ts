import { FAQRepository, FAQItem, DEFAULT_FAQS } from '../../database/repositories/faq.repo';
import { logger } from '../../core/logger';

export interface FAQMatchResult {
  matched: boolean;
  response?: string;
  intent?: string;
  itemId?: string;
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

interface NormalizedFAQItem {
  id: string;
  category: string;
  response: string;
  matchType: 'contains' | 'exact';
  normalizedPatterns: string[];
}

export class FAQCache {
  private static instance: FAQCache;
  private faqRepo: FAQRepository = new FAQRepository();
  private cachedItems: NormalizedFAQItem[] = [];
  private isLoaded = false;

  private constructor() {
    // Initial in-memory population from static defaults
    this.populateStaticDefaults();
    // Asynchronously load custom and database items
    this.loadFromDb().catch((err) => {
      logger.debug('Initial FAQ DB load error, using static defaults', { error: err.message });
    });
  }

  public static getInstance(): FAQCache {
    if (!FAQCache.instance) {
      FAQCache.instance = new FAQCache();
    }
    return FAQCache.instance;
  }

  private populateStaticDefaults(): void {
    this.cachedItems = DEFAULT_FAQS.map((d, index) => ({
      id: `default_${index}`,
      category: d.category,
      response: d.response,
      matchType: d.matchType,
      normalizedPatterns: d.patterns.map((p) => normalizeArabicText(p)).filter(Boolean),
    }));
  }

  public async loadFromDb(): Promise<void> {
    try {
      const items = await this.faqRepo.getAll();
      const activeItems = items.filter((i) => i.isActive);

      if (activeItems.length > 0) {
        this.cachedItems = activeItems.map((item) => ({
          id: item.id,
          category: item.category,
          response: item.response,
          matchType: item.matchType,
          normalizedPatterns: item.patterns.map((p) => normalizeArabicText(p)).filter(Boolean),
        }));
        this.isLoaded = true;
        logger.info(`FAQCache loaded [${this.cachedItems.length}] active items from database`);
      }
    } catch (err: any) {
      logger.warn('Failed to load FAQs from DB, retaining current cache', { error: err.message });
    }
  }

  public async reload(): Promise<void> {
    await this.loadFromDb();
  }

  /**
   * Ultra-fast in-memory pattern matching (< 1ms).
   * Matches against database-backed FAQ items.
   */
  public match(rawText: string): FAQMatchResult {
    const norm = normalizeArabicText(rawText);
    if (!norm) return { matched: false };

    for (const item of this.cachedItems) {
      for (const pattern of item.normalizedPatterns) {
        if (!pattern) continue;

        let matched = false;
        if (item.matchType === 'exact') {
          matched = norm === pattern || norm.startsWith(pattern + ' ') || norm === pattern;
        } else {
          matched = norm.includes(pattern);
        }

        if (matched) {
          // Increment hit count asynchronously in background
          if (!item.id.startsWith('default_')) {
            this.faqRepo.incrementHitCount(item.id);
          }
          return {
            matched: true,
            response: item.response,
            intent: item.category,
            itemId: item.id,
          };
        }
      }
    }

    return { matched: false };
  }
}
