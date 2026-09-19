import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { DatabaseManager } from '../connection';
import { MemoryItemEntity } from './types';
import { logger } from '../../core/logger';

function toDeterministicUuid(id: string): string {
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return id;
  }
  const hash = crypto.createHash('md5').update(id).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

export class MemoryRepository {
  private inMemoryItems: Map<string, MemoryItemEntity[]> = new Map();

  constructor(private db: DatabaseManager = DatabaseManager.getInstance()) {}

  /**
   * Saves a permanent fact about the user into memory_items.
   * Avoids duplicates if the fact already exists for the user.
   */
  public async saveFact(
    userId: string,
    factText: string,
    category = 'general'
  ): Promise<MemoryItemEntity> {
    const cleanText = factText.trim();
    const pool = this.db.getPool();
    const userUuid = toDeterministicUuid(userId);

    if (pool) {
      try {
        await pool.query(
          `INSERT INTO users (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`,
          [userUuid, userId]
        );

        // Check if an identical or very similar fact already exists
        const existingRes = await pool.query(
          `SELECT id, user_id as "userId", fact_text as "factText", category, created_at as "createdAt"
           FROM memory_items
           WHERE user_id = $1 AND LOWER(fact_text) = LOWER($2)
           LIMIT 1`,
          [userUuid, cleanText]
        );

        if (existingRes.rows.length > 0) {
          return existingRes.rows[0];
        }

        const id = uuidv4();
        const res = await pool.query(
          `INSERT INTO memory_items (id, user_id, fact_text, category, created_at)
           VALUES ($1, $2, $3, $4, NOW())
           RETURNING id, user_id as "userId", fact_text as "factText", category, created_at as "createdAt"`,
          [id, userUuid, cleanText, category]
        );

        logger.info(`Saved long-term memory fact for user [${userId}]`, { factText: cleanText, category });
        return res.rows[0];
      } catch (err: any) {
        logger.warn('Failed to insert memory item into database, falling back to memory store', {
          error: err.message,
        });
      }
    }

    // In-memory fallback
    const userItems = this.inMemoryItems.get(userId) || [];
    const exists = userItems.find((m) => m.factText.toLowerCase() === cleanText.toLowerCase());
    if (exists) {
      return exists;
    }

    const newItem: MemoryItemEntity = {
      id: uuidv4(),
      userId,
      factText: cleanText,
      category,
      createdAt: new Date(),
    };
    userItems.push(newItem);
    this.inMemoryItems.set(userId, userItems);
    logger.info(`Saved in-memory memory fact for user [${userId}]`, { factText: cleanText, category });
    return newItem;
  }

  /**
   * Retrieves all memory facts for a user as plain strings formatted for LLM system prompt injection.
   */
  public async getMemories(userId: string, limit = 20): Promise<string[]> {
    const pool = this.db.getPool();
    const userUuid = toDeterministicUuid(userId);

    if (pool) {
      try {
        const res = await pool.query(
          `SELECT fact_text as "factText", category
           FROM memory_items
           WHERE user_id = $1
           ORDER BY created_at DESC
           LIMIT $2`,
          [userUuid, limit]
        );

        return res.rows.map((r) => r.factText);
      } catch (err: any) {
        logger.warn('Failed to query memory items from database, falling back to memory store', {
          error: err.message,
        });
      }
    }

    const userItems = this.inMemoryItems.get(userId) || [];
    return userItems.slice(-limit).map((m) => m.factText);
  }

  /**
   * Automatically inspects incoming user text for critical personal facts and saves them.
   * Returns any newly detected facts.
   */
  public async extractAndSaveFacts(userId: string, text: string): Promise<string[]> {
    const lower = text.toLowerCase();
    const saved: string[] = [];

    // 1. Profession / Skills
    if (
      lower.includes('flutter') &&
      (lower.includes('dev') || lower.includes('developer') || lower.includes('مطور') || lower.includes('مبرمج') || lower.includes('شغال'))
    ) {
      await this.saveFact(
        userId,
        'المستخدم يعمل كمطور تطبيقات هواتف باستخدام فلاتر (Mobile Flutter Developer)',
        'profession'
      );
      saved.push('المستخدم يعمل كمطور تطبيقات هواتف باستخدام فلاتر (Mobile Flutter Developer)');
    } else if (lower.includes('mobile dev') || lower.includes('مطور موبايل')) {
      await this.saveFact(userId, 'المستخدم يعمل كمطور تطبيقات هواتف (Mobile Developer)', 'profession');
      saved.push('المستخدم يعمل كمطور تطبيقات هواتف (Mobile Developer)');
    }

    // 2. Language / Dialect Preference
    if (
      lower.includes('كلمني مصري') ||
      lower.includes('اتكلم مصري') ||
      lower.includes('بالمصري') ||
      lower.includes('عربي مصري') ||
      lower.includes('فصحي كلمني مصري')
    ) {
      await this.saveFact(
        userId,
        'المستخدم يفضل التحدث والتواصل باللهجة المصرية العامية الودودة',
        'preference'
      );
      saved.push('المستخدم يفضل التحدث والتواصل باللهجة المصرية العامية الودودة');
    }

    // 3. Name: "اسمي محمد", "انا اسمي أحمد"
    const nameMatch = text.match(/(?:اسمي|أنا اسمي)\s+([^\s,،.]+)/i);
    if (nameMatch && nameMatch[1] && !['مطور', 'مبرمج', 'مهندس'].includes(nameMatch[1])) {
      const fact = `اسم المستخدم: ${nameMatch[1].trim()}`;
      await this.saveFact(userId, fact, 'identity');
      saved.push(fact);
    }

    return saved;
  }
}
