/**
 * WhatsApp Template Adapter (Phase 7.4)
 *
 * Transforms a ProactiveDispatchIntent into a strictly compliant, sanitized
 * Meta WhatsApp Template Payload for outbound delivery outside the 24-hour window.
 *
 * Strict Security Guardrail:
 * Checks all parameter values against sensitive data patterns (credentials, financial, medical).
 * Blocks any template payload containing sensitive content.
 */

import { ProactiveDispatchIntent } from '../proactive/types';
import { LanguageContext } from '../language/types';
import { ProactiveTemplateRegistry } from './template_registry';
import { MetaTemplateComponent, MetaTemplatePayload } from './types';

export class WhatsAppTemplateAdapter {
  private static readonly SENSITIVE_PATTERNS = [
    /password/i,
    /كلمة\s*(?:ال)?(?:سر|مرور)/i,
    /الباسورد/i,
    /باسورد/i,
    /token/i,
    /توكن/i,
    /api[_\s-]?key/i,
    /secret/i,
    /private[_\s-]?key/i,
    /credit\s*card/i,
    /(?:كارت|بطاقة)\s*(?:ال)?بنك/i,
    /(?:بطاقة|كارت)\s*(?:ال)?ائتمان/i,
    /cvv/i,
    /iban/i,
    /رقم\s*(?:ال)?حساب/i,
    /blood\s*pressure/i,
    /ضغط\s*(?:ال)?دم/i,
    /prescription/i,
    /روشتة/i,
    /diagnosis/i,
    /تشخيص\s*(?:طبي)?/i,
  ];

  /**
   * Sanitizes and verifies that a parameter string is safe for outbound template inclusion.
   */
  public static isSafeParameter(text: string): boolean {
    if (!text) return true;
    for (const pattern of this.SENSITIVE_PATTERNS) {
      if (pattern.test(text)) {
        return false;
      }
    }
    return true;
  }

  /**
   * Resolves the Meta language code based on runtime LanguageContext or explicit configuration.
   */
  public static resolveLanguageCode(
    languageContext?: LanguageContext,
    explicitLanguage?: string
  ): string {
    if (explicitLanguage && explicitLanguage.trim().length > 0) {
      const code = explicitLanguage.trim().toLowerCase();
      if (code.startsWith('en')) return 'en';
      if (code.startsWith('ar')) return 'ar';
      return code;
    }

    if (languageContext?.targetLanguage) {
      if (languageContext.targetLanguage === 'en') return 'en';
      if (languageContext.targetLanguage === 'ar') return 'ar';
    }

    return 'ar'; // Default fallback matching system language architecture
  }

  /**
   * Builds an approved Meta Template payload for an outbound ProactiveDispatchIntent.
   */
  public static buildTemplatePayload(
    intent: ProactiveDispatchIntent,
    options?: {
      languageContext?: LanguageContext;
      explicitLanguage?: string;
    }
  ): {
    success: boolean;
    payload?: MetaTemplatePayload;
    reason?: string;
  } {
    // 1. Resolve template name from registry
    const templateName = ProactiveTemplateRegistry.getTemplateName(intent.candidateType);
    if (!templateName) {
      return {
        success: false,
        reason: 'template_unavailable',
      };
    }

    // 2. Resolve language code
    const languageCode = this.resolveLanguageCode(options?.languageContext, options?.explicitLanguage);

    // 3. Extract and sanitize parameters
    const topic = intent.topic || 'موضوعك السابق';
    const contextDigest = intent.contextDigest || '';

    if (!this.isSafeParameter(topic) || !this.isSafeParameter(contextDigest)) {
      return {
        success: false,
        reason: 'sensitive_parameter_detected',
      };
    }

    // Truncate parameter values to Meta's single-parameter bounds (max 1024 chars)
    const sanitizedTopic = topic.trim().substring(0, 100);
    const sanitizedContext = contextDigest.trim().substring(0, 300);

    const bodyComponent: MetaTemplateComponent = {
      type: 'body',
      parameters: [
        { type: 'text', text: sanitizedTopic },
        { type: 'text', text: sanitizedContext },
      ],
    };

    const payload: MetaTemplatePayload = {
      name: templateName,
      language: {
        code: languageCode,
      },
      components: [bodyComponent],
    };

    return {
      success: true,
      payload,
    };
  }
}
