import { Request, Response } from 'express';
import { AdminAuditService } from '../audit/admin_audit.service';
import { sendAdminSuccess, sendAdminError, getCorrelationId, getAdminActor } from '../admin.types';
import { config } from '../../../config/env';
import { logger } from '../../../core/logger';
import { z } from 'zod';

export interface SafeRuntimeSettings {
  maintenanceMode: boolean;
  debugLogging: boolean;
  searchEnabled: boolean;
  proactiveEnabled: boolean;
  defaultMemoryRetentionDays: number;
}

// In-memory runtime state for dynamic control plane settings
let currentRuntimeSettings: SafeRuntimeSettings = {
  maintenanceMode: false,
  debugLogging: false,
  searchEnabled: true,
  proactiveEnabled: true,
  defaultMemoryRetentionDays: 365,
};

const UpdateSettingsSchema = z.object({
  maintenanceMode: z.boolean().optional(),
  debugLogging: z.boolean().optional(),
  searchEnabled: z.boolean().optional(),
  proactiveEnabled: z.boolean().optional(),
  defaultMemoryRetentionDays: z.number().int().min(1).max(3650).optional(),
});

export class AdminSettingsController {
  constructor(private auditService: AdminAuditService = AdminAuditService.getInstance()) {}

  public getSettings = async (req: Request, res: Response): Promise<void> => {
    try {
      // 1. Read-only infrastructure metadata (STRICT ZERO SECRET DISCLOSURE)
      const infrastructure = {
        environment: process.env.NODE_ENV || config.nodeEnv || 'development',
        serverlessPlatform: process.env.VERCEL ? 'vercel' : 'node_standard',
        deploymentVersion: process.env.VERCEL_GIT_COMMIT_SHA
          ? process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 7)
          : 'production-v10.2',
        uptimeSeconds: Math.floor(process.uptime()),
        aiProvider: {
          primary: 'groq',
          engine: 'LPU Inference Engine',
          status: 'active',
          models: {
            primary: 'openai/gpt-oss-120b',
            fastFallback: 'llama-3.3-70b-versatile',
            reasoning: 'qwen-2.5-32b',
          },
        },
        integrations: {
          whatsappCloudApi: {
            configured: Boolean(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID),
          },
          supabasePostgres: {
            configured: Boolean(process.env.SUPABASE_URL || process.env.DATABASE_URL),
          },
          tavilySearch: {
            configured: Boolean(process.env.TAVILY_API_KEY),
          },
        },
      };

      sendAdminSuccess(res, {
        infrastructure,
        runtimeSettings: currentRuntimeSettings,
      });
    } catch (err: any) {
      logger.error('[Admin Settings] Failed to get runtime settings', { error: err.message });
      sendAdminError(res, 500, 'ADMIN_INTERNAL_ERROR', 'Failed to retrieve runtime settings');
    }
  };

  public updateSettings = async (req: Request, res: Response): Promise<void> => {
    const correlationId = getCorrelationId(req);
    const actor = getAdminActor(req).name || 'admin';

    const parseRes = UpdateSettingsSchema.safeParse(req.body || {});
    if (!parseRes.success) {
      sendAdminError(res, 400, 'ADMIN_VALIDATION_ERROR', 'Invalid settings payload', parseRes.error.format());
      return;
    }

    const updates = parseRes.data;

    try {
      const oldSettings = { ...currentRuntimeSettings };
      currentRuntimeSettings = {
        ...currentRuntimeSettings,
        ...updates,
      };

      await this.auditService.recordMutation({
        adminActor: actor,
        action: 'UPDATE_RUNTIME_SETTINGS',
        resourceType: 'system_settings',
        resourceId: 'runtime_config',
        status: 'success',
        metadata: {
          appliedUpdates: updates,
          previousSettings: oldSettings,
        },
        correlationId,
      });

      sendAdminSuccess(res, currentRuntimeSettings);
    } catch (err: any) {
      logger.error('[Admin Settings] Failed to update runtime settings', { error: err.message });

      await this.auditService.recordMutation({
        adminActor: actor,
        action: 'UPDATE_RUNTIME_SETTINGS',
        resourceType: 'system_settings',
        resourceId: 'runtime_config',
        status: 'failure',
        errorMessage: err.message,
        correlationId,
      });

      sendAdminError(res, 500, 'ADMIN_INTERNAL_ERROR', 'Failed to update runtime settings');
    }
  };
}
