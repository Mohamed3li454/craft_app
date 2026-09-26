import { ResponseStrategy } from '../../database/repositories/semantic_cache.types';
import { CacheContext } from './cache.types';

export interface RenderResult {
  success: boolean;
  text?: string;
  reason?: string;
}

export class TemplateEngine {
  private static instance: TemplateEngine;

  public static getInstance(): TemplateEngine {
    if (!TemplateEngine.instance) {
      TemplateEngine.instance = new TemplateEngine();
    }
    return TemplateEngine.instance;
  }

  /**
   * Resolves the best response template for the given user language.
   * Priority:
   * 1. templates[userLanguage]
   * 2. templates["default"]
   * 3. legacyResponse fallback
   */
  public selectTemplate(
    templates: Record<string, string[]> | undefined,
    userLanguage: string,
    legacyResponse?: string
  ): string | null {
    if (templates && typeof templates === 'object') {
      // 1. Language-specific templates
      const langVariants = templates[userLanguage];
      if (Array.isArray(langVariants) && langVariants.length > 0) {
        // Return first or single variant
        return langVariants[0].trim();
      }

      // 2. Language-neutral "default" template
      const defaultVariants = templates['default'];
      if (Array.isArray(defaultVariants) && defaultVariants.length > 0) {
        return defaultVariants[0].trim();
      }
    }

    // 3. Fallback to legacy single response string
    if (legacyResponse && legacyResponse.trim()) {
      return legacyResponse.trim();
    }

    return null;
  }

  /**
   * Renders the selected template according to its strategy and context.
   * Pure deterministic string substitution — zero eval or arbitrary execution.
   */
  public render(
    strategy: ResponseStrategy,
    template: string,
    context?: CacheContext,
    userLanguage = 'ar'
  ): RenderResult {
    if (!template) {
      return { success: false, reason: 'empty_template' };
    }

    switch (strategy) {
      case 'static': {
        return { success: true, text: template };
      }

      case 'dynamic_template': {
        const rendered = this.interpolateStandardVariables(template, context, userLanguage);
        return { success: true, text: rendered };
      }

      case 'contextual_template': {
        let rendered = this.interpolateStandardVariables(template, context, userLanguage);
        rendered = rendered.replace(/\{\{previous_intent\}\}/gi, context?.previousIntent || '');
        return { success: true, text: rendered };
      }

      case 'slot_based': {
        // Find required custom slots that are not standard variables
        const standardKeys = new Set(['user_name', 'bot_name', 'channel', 'language', 'current_date']);
        const slotMatches = template.match(/\{\{([a-zA-Z0-9_]+)\}\}/g) || [];

        let rendered = this.interpolateStandardVariables(template, context, userLanguage);

        for (const rawSlot of slotMatches) {
          const slotName = rawSlot.replace(/^\{\{|\}\}$/g, '').trim().toLowerCase();
          if (standardKeys.has(slotName)) continue;

          const slotValue = context?.slots?.[slotName];
          if (!slotValue) {
            // Missing required slot -> must fall back to AI Router
            return { success: false, reason: `missing_slot_${slotName}` };
          }
          rendered = rendered.split(rawSlot).join(slotValue);
        }

        return { success: true, text: rendered };
      }

      case 'ai_fallback': {
        // Strategy demands routing to existing AI Router
        return { success: false, reason: 'strategy_ai_fallback' };
      }

      default: {
        return { success: true, text: template };
      }
    }
  }

  private interpolateStandardVariables(
    template: string,
    context?: CacheContext,
    userLanguage = 'ar'
  ): string {
    const userName = context?.userName?.trim() || '';
    const botName = 'كرافت (Craft)';
    const channel = context?.channel || 'whatsapp';
    const currentDate = new Date().toISOString().split('T')[0];

    let rendered = template;
    if (userName) {
      rendered = rendered.replace(/\{\{user_name\}\}/gi, userName);
    } else {
      rendered = rendered
        .replace(/\s*يا\s*\{\{user_name\}\}/gi, '')
        .replace(/,\s*\{\{user_name\}\}/gi, '')
        .replace(/\{\{user_name\}\}\s*,?\s*/gi, '');
    }

    return rendered
      .replace(/\{\{bot_name\}\}/gi, botName)
      .replace(/\{\{channel\}\}/gi, channel)
      .replace(/\{\{language\}\}/gi, userLanguage)
      .replace(/\{\{current_date\}\}/gi, currentDate);
  }
}
