import { DatabaseManager } from '../connection';
import { logger } from '../../core/logger';
import { redactSecrets } from '../../modules/observability/redaction';

export interface AdminAuditEntry {
  adminActor: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  status: 'success' | 'failure';
  metadata?: Record<string, any>;
  correlationId?: string;
  errorMessage?: string;
}

export interface AdminAuditRecord extends AdminAuditEntry {
  id: string;
  createdAt: string;
}

export interface AdminAuditFilter {
  action?: string;
  resourceType?: string;
  resourceId?: string;
  status?: 'success' | 'failure';
  limit?: number;
  cursor?: string;
}

export class AdminAuditRepository {
  private inMemoryLogs: AdminAuditRecord[] = [];
  private schemaEnsured = false;

  constructor(private db: DatabaseManager = DatabaseManager.getInstance()) {}

  /**
   * Recursively sanitizes any string or nested object in metadata to guarantee no secrets or auth tokens are logged.
   */
  public sanitizeMetadata(data?: Record<string, any>): Record<string, any> {
    if (!data || typeof data !== 'object') return {};

    const sanitized: Record<string, any> = {};
    const FORBIDDEN_KEYS = new Set([
      'token',
      'authorization',
      'password',
      'secret',
      'api_key',
      'apikey',
      'bearer',
      'access_token',
      'refresh_token',
      'admin_secret_key',
    ]);

    for (const [key, value] of Object.entries(data)) {
      if (FORBIDDEN_KEYS.has(key.toLowerCase())) {
        sanitized[key] = '[REDACTED_SECRET]';
      } else if (typeof value === 'string') {
        sanitized[key] = redactSecrets(value);
      } else if (typeof value === 'object' && value !== null) {
        sanitized[key] = this.sanitizeMetadata(value);
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }

  public async ensureSchema(): Promise<void> {
    if (this.schemaEnsured) return;
    const pool = this.db.getPool();
    if (!pool) {
      this.schemaEnsured = true;
      return;
    }

    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS admin_audit_logs (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          admin_actor VARCHAR(255) NOT NULL DEFAULT 'admin',
          action VARCHAR(100) NOT NULL,
          resource_type VARCHAR(100) NOT NULL,
          resource_id VARCHAR(255),
          status VARCHAR(20) NOT NULL CHECK (status IN ('success', 'failure')),
          metadata JSONB DEFAULT '{}'::jsonb,
          correlation_id VARCHAR(100),
          error_message TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_action ON admin_audit_logs (action);
        CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_resource ON admin_audit_logs (resource_type, resource_id);
        CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_created_at ON admin_audit_logs (created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_correlation_id ON admin_audit_logs (correlation_id);
      `);
      this.schemaEnsured = true;
    } catch (err: any) {
      logger.warn('Failed to ensure admin_audit_logs schema', { error: err.message });
    }
  }

  public async record(entry: AdminAuditEntry): Promise<AdminAuditRecord> {
    const sanitizedMetadata = this.sanitizeMetadata(entry.metadata);
    const sanitizedError = entry.errorMessage ? redactSecrets(entry.errorMessage) : undefined;
    const pool = this.db.getPool();

    if (pool) {
      try {
        await this.ensureSchema();
        const query = `
          INSERT INTO admin_audit_logs (
            admin_actor, action, resource_type, resource_id, status, metadata, correlation_id, error_message
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          RETURNING 
            id,
            admin_actor as "adminActor",
            action,
            resource_type as "resourceType",
            resource_id as "resourceId",
            status,
            metadata,
            correlation_id as "correlationId",
            error_message as "errorMessage",
            created_at as "createdAt"
        `;
        const values = [
          entry.adminActor || 'admin',
          entry.action,
          entry.resourceType,
          entry.resourceId || null,
          entry.status,
          JSON.stringify(sanitizedMetadata),
          entry.correlationId || null,
          sanitizedError || null,
        ];
        const res = await pool.query(query, values);
        return res.rows[0];
      } catch (err: any) {
        logger.error('Failed to insert admin audit log in database, falling back to memory', {
          error: err.message,
          action: entry.action,
        });
      }
    }

    const fallbackRecord: AdminAuditRecord = {
      id: `audit_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      adminActor: entry.adminActor || 'admin',
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId,
      status: entry.status,
      metadata: sanitizedMetadata,
      correlationId: entry.correlationId,
      errorMessage: sanitizedError,
      createdAt: new Date().toISOString(),
    };
    this.inMemoryLogs.unshift(fallbackRecord);
    return fallbackRecord;
  }

  public async list(filter: AdminAuditFilter = {}): Promise<{ items: AdminAuditRecord[]; nextCursor: string | null }> {
    const limit = Math.min(Math.max(filter.limit || 20, 1), 100);
    const pool = this.db.getPool();

    if (pool) {
      try {
        await this.ensureSchema();
        const conditions: string[] = [];
        const params: any[] = [];
        let pIndex = 1;

        if (filter.action) {
          conditions.push(`action = $${pIndex++}`);
          params.push(filter.action);
        }
        if (filter.resourceType) {
          conditions.push(`resource_type = $${pIndex++}`);
          params.push(filter.resourceType);
        }
        if (filter.resourceId) {
          conditions.push(`resource_id = $${pIndex++}`);
          params.push(filter.resourceId);
        }
        if (filter.status) {
          conditions.push(`status = $${pIndex++}`);
          params.push(filter.status);
        }
        if (filter.cursor) {
          conditions.push(`created_at < $${pIndex++}`);
          params.push(new Date(filter.cursor).toISOString());
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        params.push(limit + 1);

        const query = `
          SELECT 
            id,
            admin_actor as "adminActor",
            action,
            resource_type as "resourceType",
            resource_id as "resourceId",
            status,
            metadata,
            correlation_id as "correlationId",
            error_message as "errorMessage",
            created_at as "createdAt"
          FROM admin_audit_logs
          ${whereClause}
          ORDER BY created_at DESC
          LIMIT $${pIndex}
        `;
        const res = await pool.query(query, params);
        const rows = res.rows;
        let nextCursor: string | null = null;

        if (rows.length > limit) {
          const nextItem = rows.pop();
          nextCursor = nextItem.createdAt;
        }

        return { items: rows, nextCursor };
      } catch (err: any) {
        logger.warn('Failed to query admin_audit_logs, falling back to in-memory', { error: err.message });
      }
    }

    let logs = [...this.inMemoryLogs];
    if (filter.action) logs = logs.filter(l => l.action === filter.action);
    if (filter.resourceType) logs = logs.filter(l => l.resourceType === filter.resourceType);
    if (filter.resourceId) logs = logs.filter(l => l.resourceId === filter.resourceId);
    if (filter.status) logs = logs.filter(l => l.status === filter.status);
    if (filter.cursor) {
      const cursorTime = new Date(filter.cursor).getTime();
      logs = logs.filter(l => new Date(l.createdAt).getTime() < cursorTime);
    }

    const items = logs.slice(0, limit);
    const nextCursor = logs.length > limit ? items[items.length - 1].createdAt : null;
    return { items, nextCursor };
  }

  public getInMemoryLogs(): AdminAuditRecord[] {
    return [...this.inMemoryLogs];
  }

  public clearInMemoryLogs(): void {
    this.inMemoryLogs = [];
  }
}
