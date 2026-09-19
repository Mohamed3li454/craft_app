import { config } from '../../config/env';
import { logger } from '../../core/logger';

export interface WhatsAppButton {
  id: string;
  title: string;
}

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

  public async sendInteractiveButtons(
    to: string,
    bodyText: string,
    buttons: WhatsAppButton[]
  ): Promise<boolean> {
    if (!this.phoneNumberId || !this.accessToken) {
      logger.warn('[WhatsApp Mock Mode] Missing credentials, interactive buttons logged instead', {
        to,
        bodyText,
        buttons,
      });
      return true;
    }

    const cleanTo = to.replace(/[^\d]/g, '');
    const url = `https://graph.facebook.com/v22.0/${this.phoneNumberId}/messages`;

    // Format Meta Quick-Reply buttons (max 3 buttons, title max 20 chars, id max 256 chars)
    const formattedButtons = buttons.slice(0, 3).map((b) => ({
      type: 'reply',
      reply: {
        id: b.id.substring(0, 256),
        title: b.title.substring(0, 20),
      },
    }));

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: cleanTo,
          type: 'interactive',
          interactive: {
            type: 'button',
            body: {
              text: bodyText.substring(0, 1024),
            },
            action: {
              buttons: formattedButtons,
            },
          },
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        logger.error('Meta WhatsApp API error for interactive buttons, falling back to text', {
          error: errorData,
        });
        return this.sendTextMessage(to, bodyText);
      }

      logger.info(`WhatsApp interactive buttons sent successfully to [${cleanTo}]`);
      return true;
    } catch (err: any) {
      logger.error('Failed to send WhatsApp interactive buttons, falling back to text', {
        error: err.message,
      });
      return this.sendTextMessage(to, bodyText);
    }
  }
}
