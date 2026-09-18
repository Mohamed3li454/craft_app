import crypto from 'crypto';
import { config } from '../../config/env';
import { logger } from '../../core/logger';

export function verifyMetaSignature(
  rawBody: Buffer | string,
  signatureHeader?: string
): boolean {
  if (!config.whatsapp.appSecret) {
    // If no app secret is configured during local testing, allow requests with warning
    logger.warn('WHATSAPP_APP_SECRET not configured, skipping HMAC verification');
    return true;
  }

  if (!signatureHeader) {
    logger.warn('Missing X-Hub-Signature-256 header in WhatsApp webhook request');
    return false;
  }

  const parts = signatureHeader.split('=');
  const signature = parts[1];

  if (!signature) {
    return false;
  }

  const hmac = crypto.createHmac('sha256', config.whatsapp.appSecret);
  const digest = hmac.update(rawBody).digest('hex');

  const isValid = crypto.timingSafeEqual(
    Buffer.from(signature, 'utf8'),
    Buffer.from(digest, 'utf8')
  );

  if (!isValid) {
    logger.warn('Invalid X-Hub-Signature-256 in WhatsApp webhook request');
  }

  return isValid;
}
