import { AdminAuditRepository, AdminAuditEntry, AdminAuditRecord, AdminAuditFilter } from '../../../database/repositories/admin_audit.repo';
import { logger } from '../../../core/logger';

export class AdminAuditService {
  private static instance: AdminAuditService;

  constructor(private auditRepo: AdminAuditRepository = new AdminAuditRepository()) {}

  public static getInstance(): AdminAuditService {
    if (!AdminAuditService.instance) {
      AdminAuditService.instance = new AdminAuditService();
    }
    return AdminAuditService.instance;
  }

  public async recordMutation(entry: AdminAuditEntry): Promise<AdminAuditRecord> {
    try {
      const record = await this.auditRepo.record(entry);
      logger.info(`[Admin Audit] ${entry.action} on ${entry.resourceType}:${entry.resourceId || 'global'} [${entry.status}]`, {
        actor: entry.adminActor,
        correlationId: entry.correlationId,
      });
      return record;
    } catch (err: any) {
      logger.error('Failed to record admin audit entry', {
        error: err.message,
        action: entry.action,
      });
      throw err;
    }
  }

  public async listLogs(filter?: AdminAuditFilter): Promise<{ items: AdminAuditRecord[]; nextCursor: string | null }> {
    return this.auditRepo.list(filter);
  }

  public async listAuditLogs(filter?: AdminAuditFilter): Promise<{ items: AdminAuditRecord[]; nextCursor: string | null }> {
    return this.listLogs(filter);
  }

  public getRepository(): AdminAuditRepository {
    return this.auditRepo;
  }
}

export function sanitizeMetadata(data?: Record<string, any>): Record<string, any> {
  const repo = new AdminAuditRepository();
  return repo.sanitizeMetadata(data);
}
