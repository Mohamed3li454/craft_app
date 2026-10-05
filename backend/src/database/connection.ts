import { Pool } from 'pg';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config/env';
import { logger } from '../core/logger';
import { isProductionDatabase } from './safety_guard';

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
          max: process.env.PG_POOL_MAX ? parseInt(process.env.PG_POOL_MAX, 10) : 3,
          idleTimeoutMillis: 10000,
          connectionTimeoutMillis: 5000,
        });

        this.pool.on('error', (err) => {
          logger.error('Unexpected error on idle PostgreSQL client', { error: err.message });
        });

        // Test Mutation Guard: Intercept pool.query and pool.connect in Jest tests to block mutation statements against production databases
        if (process.env.JEST_WORKER_ID !== undefined && isProductionDatabase(config.database.url)) {
          const assertNoMutation = (sqlText: any) => {
            if (process.env.ALLOW_LIVE_DB_MUTATIONS !== 'true') {
              const sql = typeof sqlText === 'string' ? sqlText : sqlText?.text;
              if (typeof sql === 'string') {
                const trimmed = sql.trim().toUpperCase();
                if (
                  trimmed.startsWith('INSERT') ||
                  trimmed.startsWith('UPDATE') ||
                  trimmed.startsWith('DELETE') ||
                  trimmed.startsWith('TRUNCATE') ||
                  trimmed.startsWith('DROP') ||
                  trimmed.startsWith('ALTER')
                ) {
                  throw new Error(
                    `SAFETY_VIOLATION: Mutation query (${trimmed.split(' ')[0]}) blocked during test execution against production database URL.`
                  );
                }
              }
            }
          };

          const originalQuery = this.pool.query.bind(this.pool);
          this.pool.query = ((...args: any[]) => {
            assertNoMutation(args[0]);
            return originalQuery(...(args as [any, any]));
          }) as any;

          const originalConnect = this.pool.connect.bind(this.pool);
          this.pool.connect = (async () => {
            const client = await originalConnect();
            const originalClientQuery = client.query.bind(client);
            client.query = ((...args: any[]) => {
              assertNoMutation(args[0]);
              return originalClientQuery(...(args as [any, any]));
            }) as any;
            return client;
          }) as any;
        }

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
