import { ReminderRepository, calculateNextDueAt } from '../../database/repositories/reminder.repo';
import { WhatsAppAdapter, isBsuid } from '../whatsapp/adapter';
import { ChatRepository } from '../../database/repositories/chat.repo';
import { AgentOrchestrator } from '../agent/orchestrator';
import { logger } from '../../core/logger';

export class ReminderScheduler {
  private static instance: ReminderScheduler;

  constructor(
    private reminderRepo: ReminderRepository = new ReminderRepository(),
    private whatsappAdapter: WhatsAppAdapter = new WhatsAppAdapter(),
    private chatRepo: ChatRepository = new ChatRepository(),
    private orchestrator: AgentOrchestrator = new AgentOrchestrator()
  ) {}

  public static getInstance(): ReminderScheduler {
    if (!ReminderScheduler.instance) {
      ReminderScheduler.instance = new ReminderScheduler();
    }
    return ReminderScheduler.instance;
  }

  /**
   * Dispatches any due reminders whose due_at <= NOW()
   */
  public async checkAndDispatchDueReminders(): Promise<{ dispatchedCount: number; remindersDispatched: string[] }> {
    const dueList = await this.reminderRepo.getDueReminders();
    if (dueList.length === 0) {
      return { dispatchedCount: 0, remindersDispatched: [] };
    }

    logger.info(`Found [${dueList.length}] due reminders to dispatch.`);
    const dispatchedTitles: string[] = [];

    for (const item of dueList) {
      // Resolve target phone or destination
      let targetPhone = item.phoneNumber;

      if (!targetPhone && item.userName) {
        if (item.userName.startsWith('wa_')) {
          targetPhone = item.userName.replace('wa_', '');
        } else if (/^\d{8,15}$/.test(item.userName.replace(/\D/g, ''))) {
          targetPhone = item.userName.replace(/\D/g, '');
        }
      }

      // Fallback: lookup in users & whatsapp_contacts via userId
      if (!targetPhone && item.userId) {
        try {
          const pool = this.reminderRepo['db']?.getPool?.();
          if (pool) {
            const res = await pool.query(
              `SELECT COALESCE(u.phone_number, wc.wa_id, u.bsuid) as phone 
               FROM users u 
               LEFT JOIN whatsapp_contacts wc ON wc.user_id = u.id 
               WHERE u.id = $1 LIMIT 1`,
              [item.userId]
            );
            if (res.rows[0]?.phone) {
              targetPhone = res.rows[0].phone;
            }
          }
        } catch {
          // ignore lookup failure
        }
      }

      if (targetPhone) {
        // If BSUID (e.g. EG.1098...), preserve exactly; if phone number, clean non-digits
        const destination = isBsuid(targetPhone)
          ? targetPhone.trim()
          : targetPhone.replace(/[^\d]/g, '');

        if (!destination || (!isBsuid(targetPhone) && destination.length < 8)) {
          logger.warn(`Skipping reminder [${item.id}] — invalid destination: [${destination}]`);
          await this.reminderRepo.revertCompletion(item.id, 120);
          continue;
        }

        const messageText = await this.orchestrator.generateSmartReminder(item.userId, item.title);

        try {
          const sent = await this.whatsappAdapter.sendTextMessage(destination, messageText);
          if (sent) {
            // If recurring, calculate next occurrence and reschedule; otherwise mark complete
            if (item.recurrence && item.recurrence !== 'none') {
              const nextDueAt = calculateNextDueAt(item.dueAt, item.recurrence);
              await this.reminderRepo.rescheduleRecurring(item.id, nextDueAt);
              logger.info(
                `Recurring reminder [${item.id}] ("${item.title}") rescheduled for [${nextDueAt.toISOString()}] (pattern: ${item.recurrence})`
              );
            } else {
              await this.reminderRepo.completeById(item.id);
            }

            dispatchedTitles.push(item.title);

            // Record in chat history under the real user conversation
            try {
              const conv = await this.chatRepo.getOrCreateConversation(item.userId, 'whatsapp');
              await this.chatRepo.saveMessage(conv.id, 'assistant', 'Craft', messageText);
            } catch (err: any) {
              logger.warn('Failed to record reminder dispatch in chat history', { error: err.message });
            }

            logger.info(`Successfully dispatched reminder [${item.id}] ("${item.title}") to WhatsApp [${destination}]`);
          } else {
            logger.warn(`WhatsApp dispatch returned false for reminder [${item.id}], scheduling retry in 60s`);
            await this.reminderRepo.revertCompletion(item.id, 60);
          }
        } catch (err: any) {
          logger.error(`Error sending reminder to WhatsApp [${destination}]`, { error: err.message });
          await this.reminderRepo.revertCompletion(item.id, 60);
        }
      } else {
        logger.warn(`Could not resolve phone number for reminder [${item.id}] (userId: ${item.userId})`);
        await this.reminderRepo.revertCompletion(item.id, 300);
      }
    }

    return { dispatchedCount: dispatchedTitles.length, remindersDispatched: dispatchedTitles };
  }
}

