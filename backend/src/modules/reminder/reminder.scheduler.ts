import { ReminderRepository, calculateNextDueAt } from '../../database/repositories/reminder.repo';
import { WhatsAppAdapter } from '../whatsapp/adapter';
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
      // Resolve target phone number: prefer explicit phoneNumber, then derive from userName
      let targetPhone = item.phoneNumber;

      if (!targetPhone && item.userName) {
        // userName could be 'wa_201234567890' or '201234567890' or a display name
        if (item.userName.startsWith('wa_')) {
          targetPhone = item.userName.replace('wa_', '');
        } else if (/^\d{8,15}$/.test(item.userName.replace(/\D/g, ''))) {
          // userName is purely numeric → treat as phone
          targetPhone = item.userName.replace(/\D/g, '');
        }
      }

      // Last resort: derive phone from userId if it looks like a UUID mapped from wa_ prefix
      if (!targetPhone && item.userId) {
        // Try to find phone via DB lookup (userId is a resolved UUID from findOrCreateUserByPhone)
        try {
          const pool = this.reminderRepo['db']?.getPool?.();
          if (pool) {
            const res = await pool.query(
              `SELECT phone_number FROM users WHERE id = $1 LIMIT 1`,
              [item.userId]
            );
            if (res.rows[0]?.phone_number) {
              targetPhone = res.rows[0].phone_number;
            }
          }
        } catch {
          // ignore lookup failure
        }
      }

      if (targetPhone) {
        const cleanPhone = targetPhone.replace(/[^\d]/g, '');
        if (cleanPhone.length < 8) {
          logger.warn(`Skipping reminder [${item.id}] — resolved phone too short: [${cleanPhone}]`);
          continue;
        }

        const messageText = await this.orchestrator.generateSmartReminder(item.userId, item.title);

        try {
          const sent = await this.whatsappAdapter.sendTextMessage(cleanPhone, messageText);
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

            // Record in chat history
            try {
              const conv = await this.chatRepo.getOrCreateConversation(`wa_${cleanPhone}`, 'whatsapp');
              await this.chatRepo.saveMessage(conv.id, 'assistant', 'Craft', messageText);
            } catch (err: any) {
              logger.warn('Failed to record reminder dispatch in chat history', { error: err.message });
            }

            logger.info(`Successfully dispatched reminder [${item.id}] ("${item.title}") to WhatsApp [${cleanPhone}]`);
          }
        } catch (err: any) {
          logger.error(`Error sending reminder to WhatsApp [${cleanPhone}]`, { error: err.message });
        }
      }
    }

    return { dispatchedCount: dispatchedTitles.length, remindersDispatched: dispatchedTitles };
  }
}

