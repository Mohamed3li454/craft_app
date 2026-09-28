import { WhatsAppAdapter } from './adapter';
import { logger } from '../../core/logger';

export interface TypingControllerOptions {
  heartbeatIntervalMs?: number; // default: 18000ms (18s) to stay within Meta 25s window
}

/**
 * Manages the lifecycle of the WhatsApp typing indicator for a specific inbound message.
 * - Dispatches typing indicator immediately upon start (best-effort, non-blocking).
 * - Periodically refreshes typing indicator (every ~18s) to cover multi-step agent workflows.
 * - Safely stops on request completion or failure via try/finally.
 * - Completely isolated per request/recipient; zero global state.
 */
export class WhatsAppTypingController {
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;
  private readonly heartbeatIntervalMs: number;

  constructor(
    private readonly adapter: WhatsAppAdapter,
    private readonly messageId: string,
    private readonly correlationId?: string,
    options?: TypingControllerOptions
  ) {
    this.heartbeatIntervalMs = options?.heartbeatIntervalMs ?? 18000;
  }

  /**
   * Starts the typing indicator and heartbeat.
   * Completely safe and non-blocking: errors are caught and logged at debug level.
   */
  public start(): void {
    if (!this.messageId || this.stopped) return;

    // 1. Initial immediate dispatch
    this.refresh();

    // 2. Schedule heartbeat refresh for long-running / multi-step operations
    this.timer = setInterval(() => {
      if (this.stopped) {
        this.stop();
        return;
      }
      this.refresh();
    }, this.heartbeatIntervalMs);

    // Unref timer so it doesn't hold open process in serverless / test runners
    if (this.timer && typeof this.timer.unref === 'function') {
      this.timer.unref();
    }
  }

  /**
   * Dispatches or refreshes the typing indicator for this message.
   * Best-effort: failure never throws and never affects request execution.
   */
  public refresh(): void {
    if (!this.messageId || this.stopped) return;

    this.adapter
      .sendTypingIndicator(this.messageId)
      .catch((err: any) => {
        logger.debug('[WhatsApp Typing] Failed to dispatch typing indicator', {
          error: err?.message,
          messageId: this.messageId,
          correlationId: this.correlationId,
        });
      });
  }

  /**
   * Stops the typing heartbeat. Safe to call multiple times or in finally blocks.
   */
  public stop(): void {
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  public isStopped(): boolean {
    return this.stopped;
  }
}
