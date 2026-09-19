import { ReminderRepository } from '../../database/repositories/reminder.repo';
import { WhatsAppAdapter } from '../whatsapp/adapter';
import { ChatRepository } from '../../database/repositories/chat.repo';
import { logger } from '../../core/logger';
import { ReminderEntity } from '../../database/repositories/types';

export class ReminderScheduler {
  private static instance: ReminderScheduler;

  constructor(
    private reminderRepo: ReminderRepository = new ReminderRepository(),
    private whatsappAdapter: WhatsAppAdapter = new WhatsAppAdapter(),
    private chatRepo: ChatRepository = new ChatRepository()
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
      let targetPhone = item.phoneNumber;
      if (!targetPhone && item.userName && item.userName.startsWith('wa_')) {
        targetPhone = item.userName.replace('wa_', '');
      }

      if (targetPhone) {
        const cleanPhone = targetPhone.replace(/[^\d]/g, '');
        const messageText = `⏰ *تذكير من كرافت*:\n\n📌 *الموضوع*: "${item.title}"\n\nحان الآن موعد هذا التذكير المحدد! أرجو أن تكون في أتم صحة وعافية. إذا احتجت لأي مساعدة، أنا في خدمتك دائماً.`;

        try {
          const sent = await this.whatsappAdapter.sendTextMessage(cleanPhone, messageText);
          if (sent) {
            await this.reminderRepo.completeById(item.id);
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

  /**
   * If a reminder is set for the very near future (<= 3 minutes),
   * schedules an in-memory timer so it can trigger right on the exact second
   * if the serverless runtime remains warm.
   */
  public scheduleImmediateTimer(reminder: ReminderEntity, rawUserId: string): void {
    if (!reminder.dueAt) return;

    const delayMs = new Date(reminder.dueAt).getTime() - Date.now();
    if (delayMs > 0 && delayMs <= 3 * 60 * 1000) {
      logger.info(`Scheduling in-memory timer for near-term reminder [${reminder.title}] in ${Math.round(delayMs / 1000)}s`);
      setTimeout(async () => {
        try {
          await this.checkAndDispatchDueReminders();
        } catch (err: any) {
          logger.error('Error in near-term reminder timer dispatch', { error: err.message });
        }
      }, delayMs);
    }
  }
}
