import { Request, Response } from 'express';
import { HealthSnapshotService, MetricsCollector } from '../../observability';
import { sendAdminSuccess, sendAdminError } from '../admin.types';
import { config } from '../../../config/env';

export class AdminObservabilityController {
  private healthService = HealthSnapshotService.getInstance();
  private metricsCollector = MetricsCollector.getInstance();

  public getHealth = async (_req: Request, res: Response): Promise<void> => {
    try {
      const snapshot = this.healthService.getSnapshot();
      sendAdminSuccess(res, {
        service: 'craft-agent-backend',
        environment: config.nodeEnv,
        status: snapshot.status,
        uptimeSeconds: snapshot.uptimeSeconds,
        snapshot,
      });
    } catch (err: any) {
      sendAdminError(res, 500, 'ADMIN_INTERNAL_ERROR', 'Failed to retrieve observability health snapshot', {
        error: err.message,
      });
    }
  };

  public getMetrics = async (_req: Request, res: Response): Promise<void> => {
    try {
      const snapshot = this.metricsCollector.getSnapshot();
      sendAdminSuccess(res, snapshot);
    } catch (err: any) {
      sendAdminError(res, 500, 'ADMIN_INTERNAL_ERROR', 'Failed to retrieve observability metrics', {
        error: err.message,
      });
    }
  };
}
