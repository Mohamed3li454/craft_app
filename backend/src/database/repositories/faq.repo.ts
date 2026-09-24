import { v4 as uuidv4 } from 'uuid';
import { DatabaseManager } from '../connection';
import { logger } from '../../core/logger';

export interface FAQItem {
  id: string;
  category: string;
  title: string;
  patterns: string[];
  response: string;
  matchType: 'contains' | 'exact';
  isActive: boolean;
  hitCount: number;
  createdAt: string;
  updatedAt: string;
}

export const DEFAULT_FAQS: Array<Omit<FAQItem, 'id' | 'hitCount' | 'createdAt' | 'updatedAt'>> = [
  {
    category: 'creator',
    title: 'المطور ومحمد علي',
    patterns: [
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
    ],
    response:
      'تم تصميمي وتطويري بالكامل بواسطة المهندس *محمد علي (Mohamed Ali)* وفريق منظومة *Craft* كوكيل ذكي متطور لمساعدتك وإنجاز مهامك اليومية بأعلى كفاءة وسرعة! 🚀✨\n\nتأمرني بأي حاجة يا باشا؟',
    matchType: 'contains',
    isActive: true,
  },
  {
    category: 'identity',
    title: 'التعريف بـ كرافت',
    patterns: [
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
    ],
    response:
      'أنا *كرافت (Craft)* ⚡، مساعدك الشخصي الذكي! أقدر أساعدك في كل حاجة: الإجابة على استفساراتك، البحث المباشر في الإنترنت، إدارة وتنظيم تذكيراتك ومواعيدك، وفحص الصور والملفات الصوتية والمستندات بدقة.\n\nقولي يا باشا، أقدر أساعدك بإيه النهاردة؟',
    matchType: 'exact',
    isActive: true,
  },
  {
    category: 'age',
    title: 'العمر والسن',
    patterns: [
      'عندك كام سنة',
      'عمرك كام',
      'سنك كام',
      'كم عمرك',
      'تاريخ ميلادك',
      'متى ولدت',
    ],
    response:
      'أنا ذكاء اصطناعي، ماليش سن أو عمر بالمعنى التقليدي 🤖، دايماً متحدث في أحدث نسخة وجاهز أخدمك على مدار الساعة في أي وقت!',
    matchType: 'contains',
    isActive: true,
  },
  {
    category: 'greetings',
    title: 'التحيات والترحيب',
    patterns: [
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
    ],
    response:
      'يا هلا والله يا باشا! الحمد لله كله تمام وزي الفل، يومك سعيد يا رب. طمني عليك وأنا تحت أمرك فوراً، تحب أساعدك في إيه؟ 😊',
    matchType: 'exact',
    isActive: true,
  },
  {
    category: 'thanks',
    title: 'الشكر والتقدير',
    patterns: [
      'شكرا',
      'تسلم',
      'الف شكر',
      'حبيبي',
      'تسلم ايدك',
      'شكرا جزيلا',
      'مشكور',
      'الله يخليك',
    ],
    response:
      'العفو يا باشا على راسي! أنا في خدمتك دايماً وفي أي وقت، تسلم يا غالي. 🙏✨',
    matchType: 'exact',
    isActive: true,
  },
];

export class FAQRepository {
  private inMemoryItems: Map<string, FAQItem> = new Map();
  private schemaChecked = false;

  constructor(private db: DatabaseManager = DatabaseManager.getInstance()) {
    // Seed in-memory map as initial baseline
    for (const d of DEFAULT_FAQS) {
      const id = uuidv4();
      const now = new Date().toISOString();
      this.inMemoryItems.set(id, {
        ...d,
        id,
        hitCount: 0,
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  public async ensureSchema(): Promise<void> {
    if (this.schemaChecked) return;
    const pool = this.db.getPool();
    if (!pool) return;

    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS faq_items (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          category VARCHAR(100) NOT NULL DEFAULT 'custom',
          title VARCHAR(255) NOT NULL,
          patterns TEXT[] NOT NULL DEFAULT '{}',
          response TEXT NOT NULL,
          match_type VARCHAR(20) NOT NULL DEFAULT 'contains',
          is_active BOOLEAN NOT NULL DEFAULT true,
          hit_count INT NOT NULL DEFAULT 0,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
      `);

      // Seed default items if table is empty
      const countRes = await pool.query(`SELECT COUNT(*) as count FROM faq_items`);
      const count = parseInt(countRes.rows[0]?.count || '0', 10);
      if (count === 0) {
        logger.info('Seeding default FAQ items into database...');
        for (const item of DEFAULT_FAQS) {
          await pool.query(
            `INSERT INTO faq_items (category, title, patterns, response, match_type, is_active, hit_count)
             VALUES ($1, $2, $3, $4, $5, $6, 0)`,
            [item.category, item.title, item.patterns, item.response, item.matchType, item.isActive]
          );
        }
      }

      this.schemaChecked = true;
    } catch (err: any) {
      logger.warn('Failed to ensure faq_items schema in PostgreSQL', { error: err.message });
    }
  }

  public async getAll(): Promise<FAQItem[]> {
    const pool = this.db.getPool();
    if (pool) {
      try {
        await this.ensureSchema();
        const res = await pool.query(`
          SELECT id, category, title, patterns, response, match_type, is_active, hit_count, created_at, updated_at
          FROM faq_items
          ORDER BY hit_count DESC, created_at ASC
        `);
        return res.rows.map((r: any) => ({
          id: r.id,
          category: r.category,
          title: r.title,
          patterns: Array.isArray(r.patterns) ? r.patterns : [],
          response: r.response,
          matchType: r.match_type,
          isActive: r.is_active,
          hitCount: parseInt(r.hit_count || '0', 10),
          createdAt: r.created_at ? new Date(r.created_at).toISOString() : new Date().toISOString(),
          updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : new Date().toISOString(),
        }));
      } catch (err: any) {
        logger.warn('Failed to fetch FAQs from DB, using in-memory store', { error: err.message });
      }
    }
    return Array.from(this.inMemoryItems.values());
  }

  public async create(data: {
    category?: string;
    title: string;
    patterns: string[];
    response: string;
    matchType?: 'contains' | 'exact';
  }): Promise<FAQItem> {
    const pool = this.db.getPool();
    const id = uuidv4();
    const category = (data.category || 'custom').trim();
    const title = data.title.trim();
    const patterns = (data.patterns || []).map((p) => p.trim()).filter(Boolean);
    const response = data.response.trim();
    const matchType = data.matchType === 'exact' ? 'exact' : 'contains';
    const now = new Date().toISOString();

    if (pool) {
      try {
        await this.ensureSchema();
        const res = await pool.query(
          `INSERT INTO faq_items (id, category, title, patterns, response, match_type, is_active, hit_count, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, true, 0, NOW(), NOW())
           RETURNING *`,
          [id, category, title, patterns, response, matchType]
        );
        const r = res.rows[0];
        return {
          id: r.id,
          category: r.category,
          title: r.title,
          patterns: r.patterns,
          response: r.response,
          matchType: r.match_type,
          isActive: r.is_active,
          hitCount: r.hit_count,
          createdAt: new Date(r.created_at).toISOString(),
          updatedAt: new Date(r.updated_at).toISOString(),
        };
      } catch (err: any) {
        logger.error('Failed to insert FAQ item in DB', { error: err.message });
      }
    }

    const newItem: FAQItem = {
      id,
      category,
      title,
      patterns,
      response,
      matchType,
      isActive: true,
      hitCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    this.inMemoryItems.set(id, newItem);
    return newItem;
  }

  public async update(
    id: string,
    data: {
      category?: string;
      title?: string;
      patterns?: string[];
      response?: string;
      matchType?: 'contains' | 'exact';
      isActive?: boolean;
    }
  ): Promise<FAQItem | null> {
    const pool = this.db.getPool();

    if (pool) {
      try {
        await this.ensureSchema();
        const updates: string[] = ['updated_at = NOW()'];
        const values: any[] = [];
        let idx = 1;

        if (data.category !== undefined) {
          updates.push(`category = $${idx++}`);
          values.push(data.category.trim());
        }
        if (data.title !== undefined) {
          updates.push(`title = $${idx++}`);
          values.push(data.title.trim());
        }
        if (data.patterns !== undefined) {
          updates.push(`patterns = $${idx++}`);
          values.push(data.patterns.map((p) => p.trim()).filter(Boolean));
        }
        if (data.response !== undefined) {
          updates.push(`response = $${idx++}`);
          values.push(data.response.trim());
        }
        if (data.matchType !== undefined) {
          updates.push(`match_type = $${idx++}`);
          values.push(data.matchType === 'exact' ? 'exact' : 'contains');
        }
        if (data.isActive !== undefined) {
          updates.push(`is_active = $${idx++}`);
          values.push(data.isActive);
        }

        values.push(id);
        const res = await pool.query(
          `UPDATE faq_items SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
          values
        );
        if (res.rows.length === 0) return null;
        const r = res.rows[0];
        return {
          id: r.id,
          category: r.category,
          title: r.title,
          patterns: r.patterns,
          response: r.response,
          matchType: r.match_type,
          isActive: r.is_active,
          hitCount: r.hit_count,
          createdAt: new Date(r.created_at).toISOString(),
          updatedAt: new Date(r.updated_at).toISOString(),
        };
      } catch (err: any) {
        logger.error('Failed to update FAQ item in DB', { error: err.message, id });
      }
    }

    const existing = this.inMemoryItems.get(id);
    if (!existing) return null;
    const updated: FAQItem = {
      ...existing,
      category: data.category !== undefined ? data.category.trim() : existing.category,
      title: data.title !== undefined ? data.title.trim() : existing.title,
      patterns:
        data.patterns !== undefined
          ? data.patterns.map((p) => p.trim()).filter(Boolean)
          : existing.patterns,
      response: data.response !== undefined ? data.response.trim() : existing.response,
      matchType: data.matchType !== undefined ? data.matchType : existing.matchType,
      isActive: data.isActive !== undefined ? data.isActive : existing.isActive,
      updatedAt: new Date().toISOString(),
    };
    this.inMemoryItems.set(id, updated);
    return updated;
  }

  public async delete(id: string): Promise<boolean> {
    const pool = this.db.getPool();
    if (pool) {
      try {
        await this.ensureSchema();
        const res = await pool.query(`DELETE FROM faq_items WHERE id = $1`, [id]);
        return (res.rowCount ?? 0) > 0;
      } catch (err: any) {
        logger.error('Failed to delete FAQ item in DB', { error: err.message, id });
      }
    }
    return this.inMemoryItems.delete(id);
  }

  public async incrementHitCount(id: string): Promise<void> {
    const pool = this.db.getPool();
    if (pool) {
      pool.query(`UPDATE faq_items SET hit_count = hit_count + 1 WHERE id = $1`, [id]).catch((err) => {
        logger.debug('Failed to increment FAQ hit count in DB', { error: err.message, id });
      });
    } else {
      const item = this.inMemoryItems.get(id);
      if (item) item.hitCount += 1;
    }
  }
}
