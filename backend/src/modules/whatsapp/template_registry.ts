/**
 * WhatsApp Proactive Template Registry (Phase 7.4)
 *
 * Provides a configuration-driven registry for approved Meta WhatsApp templates.
 * Binds proactive candidate types to configured template names, supported languages,
 * and expected parameter schemas.
 *
 * Strict Invariant:
 * If a template is not explicitly configured via environment or configuration,
 * it returns null (template_unavailable). It NEVER guesses or falls back to freeform text.
 */

import { ProactiveCandidateType } from '../proactive/types';
import { TemplateDefinition } from './types';

export class ProactiveTemplateRegistry {
  private static registeredDefinitions: Map<ProactiveCandidateType, TemplateDefinition> = new Map([
    [
      'unresolved_follow_up',
      {
        candidateType: 'unresolved_follow_up',
        envConfigKey: 'PROACTIVE_TEMPLATE_UNRESOLVED_FOLLOW_UP',
        supportedLanguages: ['ar', 'en'],
        parameterKeys: ['topic', 'context_summary'],
      },
    ],
    [
      'next_step_offer',
      {
        candidateType: 'next_step_offer',
        envConfigKey: 'PROACTIVE_TEMPLATE_NEXT_STEP_OFFER',
        supportedLanguages: ['ar', 'en'],
        parameterKeys: ['topic', 'action_step'],
      },
    ],
    [
      'follow_up_offer',
      {
        candidateType: 'follow_up_offer',
        envConfigKey: 'PROACTIVE_TEMPLATE_PLANNING_FOLLOW_UP',
        supportedLanguages: ['ar', 'en'],
        parameterKeys: ['topic', 'plan_title'],
      },
    ],
  ]);

  /**
   * Dynamic overrides for unit testing or runtime reconfiguration.
   */
  private static dynamicOverrides: Map<ProactiveCandidateType, string> = new Map();

  /**
   * Resolves the configured approved Meta template name for a given candidate type.
   */
  public static getTemplateName(candidateType: ProactiveCandidateType): string | null {
    if (this.dynamicOverrides.has(candidateType)) {
      return this.dynamicOverrides.get(candidateType) || null;
    }

    const def = this.registeredDefinitions.get(candidateType);
    if (!def) return null;

    const envValue = process.env[def.envConfigKey];
    if (envValue && envValue.trim().length > 0) {
      return envValue.trim();
    }

    return null;
  }

  /**
   * Gets the template definition if configured.
   */
  public static getDefinition(candidateType: ProactiveCandidateType): TemplateDefinition | null {
    return this.registeredDefinitions.get(candidateType) || null;
  }

  /**
   * Overrides template configuration for unit tests.
   */
  public static setTemplateOverride(candidateType: ProactiveCandidateType, templateName: string | null): void {
    if (templateName === null) {
      this.dynamicOverrides.delete(candidateType);
    } else {
      this.dynamicOverrides.set(candidateType, templateName);
    }
  }

  /**
   * Clears all dynamic test overrides.
   */
  public static clearOverrides(): void {
    this.dynamicOverrides.clear();
  }
}
