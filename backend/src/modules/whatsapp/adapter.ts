import { config } from '../../config/env';
import { logger } from '../../core/logger';
import { cleanWhatsAppText, splitWhatsAppMessage } from './formatter';
import { MetaTemplatePayload } from './types';

export interface WhatsAppButton {
  id: string;
  title: string;
}

/**
 * Checks whether a WhatsApp destination address represents a Business-Scoped User ID (BSUID).
 * Phone numbers (with or without '+') contain strictly digits.
 * BSUIDs are alphanumeric or contain non-digit characters (e.g., '.', '_').
 */
export function isBsuid(recipient: string): boolean {
  const trimmed = recipient.trim();
  return !/^\+?\d+$/.test(trimmed);
}

/**
 * Normalizes a WhatsApp recipient address:
 * - If numeric phone number (e.g. "+2010...", "2010...", "010..."): strips non-digits.
 * - If alphanumeric BSUID (e.g. "EG.12345...", username-scoped ID): preserves exactly without stripping letters/dots.
 */
export function normalizeWhatsAppDestination(to: string): string {
  const trimmed = to.trim();
  if (/^\+?\d+$/.test(trimmed)) {
    return trimmed.replace(/[^\d]/g, '');
  }
  return trimmed;
}

/**
 * Builds the Meta Graph API addressing fields:
 * - Phone numbers use: { to: "<PHONE_NUMBER>" }
 * - BSUIDs use: { recipient: "<BSUID>" }
 */
export function buildRecipientPayload(to: string): { to: string } | { recipient: string } {
  const destination = normalizeWhatsAppDestination(to);
  if (isBsuid(to)) {
    return { recipient: destination };
  }
  return { to: destination };
}

export class WhatsAppAdapter {
  private phoneNumberId?: string;
  private accessToken?: string;

  constructor(phoneNumberId?: string, accessToken?: string) {
    this.phoneNumberId = phoneNumberId;
    this.accessToken = accessToken;
  }

  /**
   * Dispatches a single raw message block directly via Meta Graph API
   */
  public async sendRawTextMessage(to: string, text: string): Promise<boolean> {
    const effectivePhoneId = this.phoneNumberId || config.whatsapp.phoneNumberId;
    const effectiveToken = this.accessToken || config.whatsapp.accessToken;

    if (!effectivePhoneId || !effectiveToken) {
      if (config.nodeEnv === 'production') {
        logger.error('[WhatsApp Production Error] Missing WhatsApp credentials (WHATSAPP_PHONE_NUMBER_ID or WHATSAPP_ACCESS_TOKEN). Dispatch aborted.');
        return false;
      }
      logger.warn('[WhatsApp Mock Mode] Missing credentials, message logged instead of dispatched');
      return true;
    }

    const recipientPayload = buildRecipientPayload(to);
    const url = `https://graph.facebook.com/v22.0/${effectivePhoneId}/messages`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${effectiveToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          ...recipientPayload,
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

      logger.info('WhatsApp text reply sent successfully');
      return true;
    } catch (err: any) {
      logger.error('Failed to send WhatsApp message', { error: err.message });
      return false;
    }
  }

  /**
   * Cleans text (converting markdown tables and HTML tags) and splits long responses
   * into 2 to 3 natural, readable messages sent sequentially.
   */
  public async sendTextMessage(to: string, text: string): Promise<boolean> {
    const formatted = cleanWhatsAppText(text);
    const chunks = splitWhatsAppMessage(formatted);

    let allSuccess = true;
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const success = await this.sendRawTextMessage(to, chunk);
      if (!success) {
        allSuccess = false;
      }

      // Stagger sequential chunks slightly so Meta delivers them in proper visual order
      if (i < chunks.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 350));
      }
    }

    return allSuccess;
  }

  /**
   * Dispatches an outbound proactive message (freeform text or approved Meta template)
   * returning exact provider message ID, HTTP status, and detailed error payload.
   *
   * Security & Environment Safety:
   * - If credentials are missing in production: fails closed (returns status: 0, isConfigMissing: true).
   * - If explicit test mock mode is enabled: returns mock success with mock wamid (forbidden in production).
   * - Never exposes credentials or authorization headers in logged errors.
   */
  public async dispatchProactiveMessage(
    to: string,
    payload: {
      type: 'freeform' | 'template';
      text?: string;
      template?: MetaTemplatePayload;
    },
    timeoutMs = 8000
  ): Promise<{
    success: boolean;
    status: number;
    providerMessageId?: string;
    error?: any;
    isMock?: boolean;
    isConfigMissing?: boolean;
  }> {
    if (process.env.WHATSAPP_MOCK_DISPATCH === 'true') {
      if (config.nodeEnv === 'production') {
        logger.error('[WhatsApp Production Error] WHATSAPP_MOCK_DISPATCH is forbidden in production. Failing closed.');
        return {
          success: false,
          status: 0,
          error: 'mock_dispatch_forbidden_in_production',
        };
      }
      logger.info('[WhatsApp Mock Proactive Dispatch] Mock mode enabled, simulated provider success');
      return {
        success: true,
        status: 200,
        providerMessageId: `wamid.MOCK_${Date.now()}`,
        isMock: true,
      };
    }

    const effectivePhoneId =
      this.phoneNumberId !== undefined
        ? this.phoneNumberId
        : process.env.WHATSAPP_PHONE_NUMBER_ID || config.whatsapp.phoneNumberId;
    const effectiveToken =
      this.accessToken !== undefined
        ? this.accessToken
        : process.env.WHATSAPP_ACCESS_TOKEN || config.whatsapp.accessToken;

    if (!effectivePhoneId || !effectiveToken) {
      logger.warn('[WhatsApp Proactive Dispatch] Missing WhatsApp credentials, failing closed');
      return {
        success: false,
        status: 0,
        error: 'configuration_missing',
        isConfigMissing: true,
      };
    }

    const recipientPayload = buildRecipientPayload(to);
    const url = `https://graph.facebook.com/v22.0/${effectivePhoneId}/messages`;

    let bodyPayload: any;
    if (payload.type === 'freeform') {
      bodyPayload = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        ...recipientPayload,
        type: 'text',
        text: {
          body: payload.text || '',
        },
      };
    } else {
      bodyPayload = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        ...recipientPayload,
        type: 'template',
        template: payload.template,
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${effectiveToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(bodyPayload),
        signal: controller.signal,
      });

      clearTimeout(timer);

      const data: any = await response.json().catch(() => ({}));

      if (!response.ok) {
        return {
          success: false,
          status: response.status,
          error: data,
        };
      }

      const providerMessageId = data.messages?.[0]?.id || `wamid.GEN_${Date.now()}`;
      return {
        success: true,
        status: response.status,
        providerMessageId,
      };
    } catch (err: any) {
      clearTimeout(timer);
      return {
        success: false,
        status: 0,
        error: err,
      };
    }
  }

  /**
   * Helper to dispatch approved Meta templates.
   */
  public async sendTemplateMessage(
    to: string,
    template: MetaTemplatePayload
  ): Promise<{
    success: boolean;
    status: number;
    providerMessageId?: string;
    error?: any;
    isMock?: boolean;
    isConfigMissing?: boolean;
  }> {
    return this.dispatchProactiveMessage(to, { type: 'template', template });
  }

  public async sendInteractiveButtons(
    to: string,
    bodyText: string,
    buttons: WhatsAppButton[]
  ): Promise<boolean> {
    const effectivePhoneId = this.phoneNumberId || config.whatsapp.phoneNumberId;
    const effectiveToken = this.accessToken || config.whatsapp.accessToken;

    if (!effectivePhoneId || !effectiveToken) {
      if (config.nodeEnv === 'production') {
        logger.error('[WhatsApp Production Error] Missing WhatsApp credentials for interactive buttons. Aborting.');
        return false;
      }
      logger.warn('[WhatsApp Mock Mode] Missing credentials, interactive buttons logged instead');
      return true;
    }

    const recipientPayload = buildRecipientPayload(to);
    const url = `https://graph.facebook.com/v22.0/${effectivePhoneId}/messages`;

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
          Authorization: `Bearer ${effectiveToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          ...recipientPayload,
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

      logger.info('WhatsApp interactive buttons sent successfully');
      return true;
    } catch (err: any) {
      logger.error('Failed to send WhatsApp interactive buttons, falling back to text', {
        error: err.message,
      });
      return this.sendTextMessage(to, bodyText);
    }
  }

  /**
   * Downloads media binary payload (image, document, etc.) from Meta Graph API
   */
  public async downloadMedia(
    mediaId: string
  ): Promise<{ buffer: Buffer; mimeType: string } | null> {
    if (!this.accessToken) {
      logger.warn('[WhatsApp Mock Mode] Missing access token for media download', { mediaId });
      return null;
    }

    try {
      // 1. Get media retrieval URL from Meta Graph API
      const metaRes = await fetch(`https://graph.facebook.com/v22.0/${mediaId}`, {
        headers: { Authorization: `Bearer ${this.accessToken}` },
      });

      if (!metaRes.ok) {
        logger.error('Failed to get media URL from Meta Graph API', {
          status: metaRes.status,
          mediaId,
        });
        return null;
      }

      const mediaData: any = await metaRes.json();
      const downloadUrl = mediaData.url;
      const mimeType = mediaData.mime_type || 'application/octet-stream';

      if (!downloadUrl) {
        logger.error('No download URL returned from Meta Graph API for media', { mediaData });
        return null;
      }

      // 2. Download the binary stream with Bearer auth
      const fileRes = await fetch(downloadUrl, {
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'User-Agent': 'Craft-Backend/1.0',
        },
      });

      if (!fileRes.ok) {
        logger.error('Failed to download binary media from Meta CDN', {
          status: fileRes.status,
          mediaId,
        });
        return null;
      }

      const arrayBuffer = await fileRes.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      logger.info(`Successfully downloaded media [${mediaId}] (${buffer.length} bytes, mime: ${mimeType})`);
      return { buffer, mimeType };
    } catch (err: any) {
      logger.error('Exception downloading media from WhatsApp', { error: err.message, mediaId });
      return null;
    }
  }

  /**
   * Dispatches a typing indicator to Meta WhatsApp Cloud API.
   * This marks the incoming message as read (blue ticks) and displays the animated
   * "typing..." status bubble in the WhatsApp chat while the agent is processing.
   * The typing status automatically dismisses when the reply is sent or after 25s.
   */
  public async sendTypingIndicator(messageId: string): Promise<boolean> {
    if (!messageId) return false;

    if (!this.phoneNumberId || !this.accessToken) {
      logger.debug('[WhatsApp Mock Mode] Missing credentials, typing indicator skipped', { messageId });
      return true;
    }

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
          status: 'read',
          message_id: messageId,
          typing_indicator: {
            type: 'text',
          },
        }),
      });

      if (!response.ok) {
        const errorData: any = await response.json().catch(() => ({}));
        logger.debug('Meta typing indicator API returned non-200, attempting read status fallback', {
          status: response.status,
          error: errorData,
        });

        // Fallback: If typing_indicator is rejected by the Graph version/tier, mark as read only
        await fetch(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            status: 'read',
            message_id: messageId,
          }),
        }).catch(() => {});

        return false;
      }

      logger.debug(`Typing indicator & read receipt dispatched for message [${messageId}]`);
      return true;
    } catch (err: any) {
      logger.warn('Failed to dispatch typing indicator', { error: err.message, messageId });
      return false;
    }
  }
}
