/**
 * Reminder Trigger Adapter (Phase 9.2)
 *
 * Provides a clean, decoupled abstraction between schedule invocation sources
 * (Vercel Cron, External Cron, manual admin triggers, integration test runners)
 * and the authoritative ReminderScheduler.
 */

import { ReminderScheduler, ReminderDispatchRunResult } from './reminder.scheduler';
import { MetricsCollector } from '../observability/metrics';
import { logger } from '../../core/logger';

export type TriggerSource = 'vercel_cron' | 'external_cron' | 'manual' | 'test';

export interface ReminderTriggerOptions {
  triggerSource: TriggerSource;
  batchSize?: number;
  correlationId?: string;
}

export interface ReminderTriggerResult {
  success: boolean;
  triggerSource: TriggerSource;
  dispatchedCount: number;
  remindersDispatched: string[];
  skippedCount?: number;
  failedCount?: number;
  durationMs: number;
  error?: string;
  timestamp: string;
}

export class ReminderTrigger {
  private static instance: ReminderTrigger;

  constructor(
    private scheduler: ReminderScheduler = ReminderScheduler.getInstance()
  ) {}

  public static getInstance(): ReminderTrigger {
    if (!ReminderTrigger.instance) {
      ReminderTrigger.instance = new ReminderTrigger();
    }
    return ReminderTrigger.instance;
  }

  /**
   * Authoritative entry point for any scheduled or manual reminder check.
   */
  public async execute(options: ReminderTriggerOptions): Promise<ReminderTriggerResult> {
    const startTime = Date.now();
    const source = options.triggerSource || 'external_cron';

    logger.info(`[ReminderTrigger] Executing trigger from source [${source}]`, {
      correlationId: options.correlationId,
      batchSize: options.batchSize,
    });

    MetricsCollector.getInstance().increment('craft.reminder.trigger_invoked', 1, {
      source,
    });

    try {
      const result: ReminderDispatchRunResult = await this.scheduler.checkAndDispatchDueReminders(
        options.batchSize
      );

      const durationMs = Date.now() - startTime;
      MetricsCollector.getInstance().observe('craft.reminder.dispatch_latency', durationMs, {
        source,
      });

      return {
        success: true,
        triggerSource: source,
        dispatchedCount: result.dispatchedCount,
        remindersDispatched: result.remindersDispatched,
        skippedCount: result.skippedCount,
        failedCount: result.failedCount,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (err: any) {
      const durationMs = Date.now() - startTime;
      logger.error('[ReminderTrigger] Execution failed', {
        source,
        error: err.message,
        correlationId: options.correlationId,
      });

      MetricsCollector.getInstance().increment('craft.reminder.trigger_failed', 1, {
        source,
      });

      return {
        success: false,
        triggerSource: source,
        dispatchedCount: 0,
        remindersDispatched: [],
        durationMs,
        error: err.message,
        timestamp: new Date().toISOString(),
      };
    }
  }
}
