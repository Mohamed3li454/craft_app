import { ConfirmationRepository } from '../../database/repositories/confirmation.repo';
import { ConfirmationEntity } from '../../database/repositories/types';
import { config } from '../../config/env';
import { logger } from '../../core/logger';

export class ConfirmationService {
  constructor(
    private confirmationRepo: ConfirmationRepository = new ConfirmationRepository()
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
  ): Promise<{ success: boolean; message: string; confirmation?: ConfirmationEntity }> {
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

    logger.info(`Resolved confirmation token [${token}] with decision: [${decision}]`);
    return {
      success: true,
      message: `Action [${confirmation.actionName}] was successfully ${decision}.`,
      confirmation,
    };
  }
}
