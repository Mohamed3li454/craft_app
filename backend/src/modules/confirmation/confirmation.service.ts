import { ConfirmationRepository } from '../../database/repositories/confirmation.repo';
import { ReminderRepository } from '../../database/repositories/reminder.repo';
import { ConfirmationEntity } from '../../database/repositories/types';
import { config } from '../../config/env';
import { logger } from '../../core/logger';

export class ConfirmationService {
  constructor(
    private confirmationRepo: ConfirmationRepository = new ConfirmationRepository(),
    private reminderRepo: ReminderRepository = new ReminderRepository()
  ) {}

  public async createConfirmationRequest(
    agentRunId: string,
    userId: string,
    actionName: string,
    description: string,
    payload: Record<string, any>
  ): Promise<ConfirmationEntity> {
    const expiresAt = new Date(
      Date.now() + config.security.confirmationExpiresMinutes * 60 * 1000
    );

    const request = await this.confirmationRepo.create(
      agentRunId,
      userId,
      actionName,
      description,
      payload,
      expiresAt
    );

    logger.info(`Created confirmation request for action [${actionName}]`, {
      token: request.token,
      expiresAt: request.expiresAt,
    });

    return request;
  }

  public async verifyAndResolve(
    token: string,
    decision: 'approved' | 'rejected'
  ): Promise<{
    success: boolean;
    message: string;
    confirmation?: ConfirmationEntity;
    executionResult?: any;
  }> {
    const confirmation = await this.confirmationRepo.getByToken(token);

    if (!confirmation) {
      return { success: false, message: 'Invalid or non-existent confirmation token.' };
    }

    if (confirmation.status !== 'pending') {
      return {
        success: false,
        message: `This action has already been ${confirmation.status}. Replay rejected.`,
      };
    }

    if (new Date() > new Date(confirmation.expiresAt)) {
      await this.confirmationRepo.updateStatus(token, 'expired');
      return {
        success: false,
        message: 'Confirmation request has expired. Please re-trigger the action.',
      };
    }

    const updated = await this.confirmationRepo.updateStatus(token, decision);
    if (!updated) {
      return { success: false, message: 'Failed to update confirmation status.' };
    }

    let executionResult: any = null;
    if (decision === 'approved') {
      if (confirmation.actionName === 'create_reminder') {
        try {
          const title = confirmation.payload?.title || 'بدون عنوان';
          const time = confirmation.payload?.time;
          executionResult = await this.reminderRepo.create(
            confirmation.userId,
            title,
            time
          );
          logger.info(`Action [create_reminder] executed successfully for user [${confirmation.userId}]`);

          if (executionResult) {
            try {
              const { ReminderScheduler } = require('../reminder/reminder.scheduler');
              ReminderScheduler.getInstance().scheduleImmediateTimer(executionResult, confirmation.userId);
            } catch (schedErr: any) {
              logger.warn('Failed to schedule immediate reminder timer', { error: schedErr.message });
            }
          }
        } catch (err: any) {
          logger.error('Failed to execute approved action [create_reminder]', {
            error: err.message,
          });
        }
      }
    }

    logger.info(`Resolved confirmation token [${token}] with decision: [${decision}]`);
    return {
      success: true,
      message: `Action [${confirmation.actionName}] was successfully ${decision}.`,
      confirmation,
      executionResult,
    };
  }
}
