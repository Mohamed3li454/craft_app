import { config } from '../../config/env';
import { logger } from '../../core/logger';

export class WhatsAppAdapter {
  private phoneNumberId?: string;
  private accessToken?: string;

  constructor() {
    this.phoneNumberId = config.whatsapp.phoneNumberId;
    this.accessToken = config.whatsapp.accessToken;
  }

  public async sendTextMessage(to: string, text: string): Promise<boolean> {
    if (!this.phoneNumberId || !this.accessToken) {
      logger.warn('[WhatsApp Mock Mode] Missing credentials, message logged instead of dispatched', {
        to,
        text,
      });
      return true;
    }

    const cleanTo = to.replace(/[^\d]/g, '');
    const url = `https://graph.facebook.com/v22.0/${this.phoneNumberId}/messages`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: cleanTo,
          type: 'text',
          text: {
            body: text,
          },
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        logger.error('Meta WhatsApp API returned an error', { error: errorData });
        return false;
      }

      logger.info(`WhatsApp text reply sent successfully to [${cleanTo}]`);
      return true;
    } catch (err: any) {
      logger.error('Failed to send WhatsApp message', { error: err.message });
      return false;
    }
  }
}
