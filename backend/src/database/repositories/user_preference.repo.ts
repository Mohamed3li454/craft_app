import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { DatabaseManager } from '../connection';
import { UserRepository, normalizePhoneNumber } from './user.repo';
import { logger } from '../../core/logger';
import { LanguagePreference, PersonalityPreference } from '../../modules/memory/types';

function toDeterministicUuid(id: string): string {
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return id;
  }
  const hash = crypto.createHash('md5').update(id).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

export class UserPreferenceRepository {
  private static sharedInMemoryPreferences: Map<string, Map<string, any>> = new Map();
  private inMemoryPreferences: Map<string, Map<string, any>> = UserPreferenceRepository.sharedInMemoryPreferences;
  private schemaChecked = false;

  public static clearInMemory(): void {
    UserPreferenceRepository.sharedInMemoryPreferences.clear();
  }

  constructor(
    private db: DatabaseManager = DatabaseManager.getInstance(),
    private userRepo: UserRepository = new UserRepository(db)
  ) {}

  public async ensureSchema(): Promise<void> {
    if (this.schemaChecked) return;
    const pool = this.db.getPool();
    if (!pool) return;

    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS user_preferences (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          preference_key VARCHAR(100) NOT NULL,
          preference_value JSONB NOT NULL,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          CONSTRAINT uq_user_pref UNIQUE (user_id, preference_key)
        );
        CREATE INDEX IF NOT EXISTS idx_user_preferences_user ON user_preferences(user_id);
        CREATE INDEX IF NOT EXISTS idx_user_preferences_user_key ON user_preferences(user_id, preference_key);
      `);
      this.schemaChecked = true;
    } catch (err: any) {
      logger.debug('Schema check for user_preferences table skipped/failed', { error: err.message });
    }
  }

  private async resolveUserId(userId: string): Promise<string> {
    if (!userId) return toDeterministicUuid('anonymous');
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) {
      return userId;
    }
    const cleanPhone = normalizePhoneNumber(userId.replace(/^wa_/, ''));
    if (cleanPhone && cleanPhone.length >= 8) {
      const user = await this.userRepo.findOrCreateUserByPhone(cleanPhone);
      return user.id;
    }
    return toDeterministicUuid(userId);
  }

  public async getPreference<T>(userId: string, key: string): Promise<T | null> {
    await this.ensureSchema();
    const userUuid = await this.resolveUserId(userId);
    const pool = this.db.getPool();

    if (pool) {
      try {
        const res = await pool.query(
          `SELECT preference_value as "preferenceValue"
           FROM user_preferences
           WHERE user_id = $1 AND preference_key = $2
           LIMIT 1`,
          [userUuid, key]
        );

        if (res.rows.length > 0) {
          const raw = res.rows[0].preferenceValue;
          return typeof raw === 'string' ? JSON.parse(raw) : raw;
        }
        return null;
      } catch (err: any) {
        logger.warn('Failed to get user preference from database, falling back to in-memory store', {
          error: err.message,
          key,
        });
      }
    }

    const userPrefs = this.inMemoryPreferences.get(userUuid) || this.inMemoryPreferences.get(userId);
    if (!userPrefs) return null;
    return (userPrefs.get(key) as T) || null;
  }

  public async setPreference<T>(userId: string, key: string, value: T): Promise<void> {
    await this.ensureSchema();
    const userUuid = await this.resolveUserId(userId);
    const pool = this.db.getPool();
    const jsonValue = JSON.stringify(value);

    if (pool) {
      try {
        await pool.query(
          `INSERT INTO users (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`,
          [userUuid, userId]
        );

        await pool.query(
          `INSERT INTO user_preferences (id, user_id, preference_key, preference_value, created_at, updated_at)
           VALUES ($1, $2, $3, $4::jsonb, NOW(), NOW())
           ON CONFLICT (user_id, preference_key)
           DO UPDATE SET preference_value = EXCLUDED.preference_value, updated_at = NOW()`,
          [uuidv4(), userUuid, key, jsonValue]
        );

        logger.info(`Saved structured preference [${key}] for user [${userId}]`);
        return;
      } catch (err: any) {
        logger.warn('Failed to set user preference in database, falling back to in-memory store', {
          error: err.message,
          key,
        });
      }
    }

    let userPrefs = this.inMemoryPreferences.get(userUuid);
    if (!userPrefs) {
      userPrefs = new Map();
      this.inMemoryPreferences.set(userUuid, userPrefs);
    }
    userPrefs.set(key, JSON.parse(jsonValue));
    logger.info(`Saved in-memory structured preference [${key}] for user [${userId}]`);
  }

  public async deletePreference(userId: string, key: string): Promise<boolean> {
    await this.ensureSchema();
    const userUuid = await this.resolveUserId(userId);
    const pool = this.db.getPool();

    if (pool) {
      try {
        const res = await pool.query(
          `DELETE FROM user_preferences WHERE user_id = $1 AND preference_key = $2 RETURNING id`,
          [userUuid, key]
        );
        return res.rowCount !== null && res.rowCount > 0;
      } catch (err: any) {
        logger.warn('Failed to delete user preference in database', { error: err.message, key });
      }
    }

    const userPrefs = this.inMemoryPreferences.get(userUuid) || this.inMemoryPreferences.get(userId);
    if (!userPrefs) return false;
    return userPrefs.delete(key);
  }

  public async getLanguagePreference(userId: string): Promise<LanguagePreference | null> {
    return this.getPreference<LanguagePreference>(userId, 'language');
  }

  public async setLanguagePreference(userId: string, preference: LanguagePreference): Promise<void> {
    const payload: LanguagePreference = {
      language: preference.language,
      dialect: preference.dialect,
      script: preference.script,
      confidence: preference.confidence ?? 1.0,
      updatedAt: new Date(),
    };
    await this.setPreference(userId, 'language', payload);
  }

  public async getPersonalityPreference(userId: string): Promise<PersonalityPreference | null> {
    return this.getPreference<PersonalityPreference>(userId, 'personality');
  }

  public async setPersonalityPreference(userId: string, preference: PersonalityPreference): Promise<void> {
    const payload: PersonalityPreference = {
      tone: preference.tone,
      formality: preference.formality,
      verbosity: preference.verbosity,
      addressingStyle: preference.addressingStyle,
      emojiPolicy: preference.emojiPolicy,
      humorLevel: preference.humorLevel,
      proactivity: preference.proactivity,
      confidence: preference.confidence ?? 1.0,
      updatedAt: new Date(),
    };
    await this.setPreference(userId, 'personality', payload);
  }
}
