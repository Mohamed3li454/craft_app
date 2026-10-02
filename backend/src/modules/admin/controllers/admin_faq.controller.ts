import { Request, Response } from 'express';
import { FAQRepository } from '../../../database/repositories/faq.repo';
import { AdminAuditService } from '../audit/admin_audit.service';
import { sendAdminSuccess, sendAdminError, getCorrelationId } from '../admin.types';
import { logger } from '../../../core/logger';
import { z } from 'zod';

const FaqCreateSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200),
  category: z.string().optional().default('custom'),
  patterns: z.array(z.string().min(1)).min(1, 'At least one pattern keyword is required'),
  response: z.string().min(1, 'Response text is required'),
  matchType: z.enum(['exact', 'contains']).optional().default('contains'),
});

const FaqUpdateSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  category: z.string().optional(),
  patterns: z.array(z.string().min(1)).optional(),
  response: z.string().min(1).optional(),
  matchType: z.enum(['exact', 'contains']).optional(),
  isActive: z.boolean().optional(),
});

export class AdminFaqController {
  constructor(
    private faqRepo: FAQRepository = new FAQRepository(),
    private auditService: AdminAuditService = AdminAuditService.getInstance()
  ) {}

  public getFaqs = async (_req: Request, res: Response): Promise<void> => {
    try {
      const items = await this.faqRepo.getAll();
      sendAdminSuccess(res, items);
    } catch (err: any) {
      logger.error('[Admin FAQ] Failed to list FAQs', { error: err.message });
      sendAdminError(res, 500, 'ADMIN_INTERNAL_ERROR', 'Failed to retrieve FAQ list');
    }
  };

  public createFaq = async (req: Request, res: Response): Promise<void> => {
    const correlationId = getCorrelationId(req);
    const actor = (req as any).adminUser?.actor || (req.headers['x-admin-actor'] as string) || 'admin';

    const parseResult = FaqCreateSchema.safeParse(req.body);
    if (!parseResult.success) {
      sendAdminError(res, 400, 'ADMIN_VALIDATION_ERROR', 'Invalid FAQ payload', {
        issues: parseResult.error.issues,
      });
      return;
    }

    const { title, category, patterns, response, matchType } = parseResult.data;

    try {
      const newItem = await this.faqRepo.create({
        title,
        category,
        patterns,
        response,
        matchType,
      });

      await this.auditService.recordMutation({
        adminActor: actor,
        action: 'CREATE_FAQ',
        resourceType: 'faq',
        resourceId: newItem.id,
        status: 'success',
        metadata: { title, category, matchType, patternsCount: patterns.length },
        correlationId,
      });

      res.status(201).json({
        success: true,
        data: newItem,
        correlationId,
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      logger.error('[Admin FAQ] Failed to create FAQ', { error: err.message });

      await this.auditService.recordMutation({
        adminActor: actor,
        action: 'CREATE_FAQ',
        resourceType: 'faq',
        status: 'failure',
        errorMessage: err.message,
        correlationId,
      });

      sendAdminError(res, 500, 'ADMIN_INTERNAL_ERROR', 'Failed to create FAQ item');
    }
  };

  public updateFaq = async (req: Request, res: Response): Promise<void> => {
    const correlationId = getCorrelationId(req);
    const actor = (req as any).adminUser?.actor || (req.headers['x-admin-actor'] as string) || 'admin';
    const id = req.params.id;

    if (!id || id.trim().length === 0) {
      sendAdminError(res, 400, 'ADMIN_VALIDATION_ERROR', 'FAQ ID is required');
      return;
    }

    const parseResult = FaqUpdateSchema.safeParse(req.body);
    if (!parseResult.success) {
      sendAdminError(res, 400, 'ADMIN_VALIDATION_ERROR', 'Invalid update payload', {
        issues: parseResult.error.issues,
      });
      return;
    }

    try {
      const updated = await this.faqRepo.update(id, parseResult.data);
      if (!updated) {
        sendAdminError(res, 404, 'ADMIN_NOT_FOUND', 'FAQ item not found');
        return;
      }

      await this.auditService.recordMutation({
        adminActor: actor,
        action: 'UPDATE_FAQ',
        resourceType: 'faq',
        resourceId: id,
        status: 'success',
        metadata: parseResult.data,
        correlationId,
      });

      sendAdminSuccess(res, updated);
    } catch (err: any) {
      logger.error('[Admin FAQ] Failed to update FAQ', { error: err.message, id });

      await this.auditService.recordMutation({
        adminActor: actor,
        action: 'UPDATE_FAQ',
        resourceType: 'faq',
        resourceId: id,
        status: 'failure',
        errorMessage: err.message,
        correlationId,
      });

      sendAdminError(res, 500, 'ADMIN_INTERNAL_ERROR', 'Failed to update FAQ item');
    }
  };

  public deleteFaq = async (req: Request, res: Response): Promise<void> => {
    const correlationId = getCorrelationId(req);
    const actor = (req as any).adminUser?.actor || (req.headers['x-admin-actor'] as string) || 'admin';
    const id = req.params.id;

    if (!id || id.trim().length === 0) {
      sendAdminError(res, 400, 'ADMIN_VALIDATION_ERROR', 'FAQ ID is required');
      return;
    }

    try {
      const deleted = await this.faqRepo.delete(id);
      if (!deleted) {
        sendAdminError(res, 404, 'ADMIN_NOT_FOUND', 'FAQ item not found');
        return;
      }

      await this.auditService.recordMutation({
        adminActor: actor,
        action: 'DELETE_FAQ',
        resourceType: 'faq',
        resourceId: id,
        status: 'success',
        correlationId,
      });

      sendAdminSuccess(res, { id, deleted: true });
    } catch (err: any) {
      logger.error('[Admin FAQ] Failed to delete FAQ', { error: err.message, id });

      await this.auditService.recordMutation({
        adminActor: actor,
        action: 'DELETE_FAQ',
        resourceType: 'faq',
        resourceId: id,
        status: 'failure',
        errorMessage: err.message,
        correlationId,
      });

      sendAdminError(res, 500, 'ADMIN_INTERNAL_ERROR', 'Failed to delete FAQ item');
    }
  };
}
