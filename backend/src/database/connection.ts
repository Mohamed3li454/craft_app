import { Pool } from 'pg';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config/env';
import { logger } from '../core/logger';

export class DatabaseManager {
  private static instance: DatabaseManager;
  private pool: Pool | null = null;
  private supabase: SupabaseClient | null = null;
  private isConnected = false;

  private constructor() {
    this.initClients();
  }

  public static getInstance(): DatabaseManager {
    if (!DatabaseManager.instance) {
      DatabaseManager.instance = new DatabaseManager();
    }
    return DatabaseManager.instance;
  }

  private initClients(): void {
    // 1. Initialize PostgreSQL connection pool if DATABASE_URL is provided
    if (config.database.url && !config.database.url.includes('[YOUR-PASSWORD]')) {
      try {
        this.pool = new Pool({
          connectionString: config.database.url,
          ssl: config.nodeEnv === 'production' ? { rejectUnauthorized: false } : undefined,
          max: 10,
          idleTimeoutMillis: 30000,
          connectionTimeoutMillis: 5000,
        });

        this.pool.on('error', (err) => {
          logger.error('Unexpected error on idle PostgreSQL client', { error: err.message });
        });

        this.isConnected = true;
        logger.info('PostgreSQL connection pool initialized');
      } catch (err: any) {
        logger.warn('Failed to initialize PostgreSQL pool, falling back to memory store', {
          error: err.message,
        });
      }
    }

    // 2. Initialize Supabase JS Client if credentials provided
    if (config.database.supabaseUrl && config.database.supabaseKey) {
      try {
        this.supabase = createClient(config.database.supabaseUrl, config.database.supabaseKey);
        logger.info('Supabase client initialized');
      } catch (err: any) {
        logger.warn('Failed to initialize Supabase client', { error: err.message });
      }
    }
  }

  public getPool(): Pool | null {
    return this.pool;
  }

  public getSupabase(): SupabaseClient | null {
    return this.supabase;
  }

  public async query(text: string, params?: any[]): Promise<any> {
    if (!this.pool) {
      throw new Error('Database pool not connected');
    }
    return this.pool.query(text, params);
  }

  public async close(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
      this.isConnected = false;
      logger.info('Database pool closed');
    }
  }
}
