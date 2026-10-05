/**
 * Canonical Trigger Contract (Phase 13.4)
 *
 * Single Source of Truth for trigger typing, classification,
 * capability policies, and pipeline persistence behaviors across Craft.
 *
 * Architecture:
 * Trigger Type -> Canonical Trigger Contract -> Trigger Classification -> Capability Policy -> Execution Engine -> Permission Gate
 */

export type AgentTriggerType =
  | 'user_message'
  | 'smart_reminder'
  | 'proactive'
  | 'proactive_morning_briefing'
  | 'proactive_reengagement'
  | 'proactive_unresolved_follow_up'
  | 'proactive_next_step_offer'
  | 'proactive_follow_up_offer';

export type TriggerFamily = 'conversational' | 'system' | 'proactive' | 'unknown';

export type TriggerCapabilityMode = 'unrestricted' | 'scoped' | 'default_deny';

export type TriggerPersistenceMode = 'persist_immediately' | 'persist_on_delivery';

export interface TriggerDefinition {
  readonly type: string;
  readonly canonicalType?: AgentTriggerType;
  readonly family: TriggerFamily;
  readonly isSystemTrigger: boolean;
  readonly allowedTools?: readonly string[];
  readonly capabilityPolicy: TriggerCapabilityMode;
  readonly persistencePolicy: TriggerPersistenceMode;
  readonly description: string;
}

/**
 * Standard classification of Craft tools into capabilities.
 */
export const CANONICAL_TRIGGER_DEFINITIONS: Record<AgentTriggerType, TriggerDefinition> = Object.freeze({
  user_message: Object.freeze({
    type: 'user_message',
    canonicalType: 'user_message',
    family: 'conversational',
    isSystemTrigger: false,
    allowedTools: undefined, // Unrestricted access to full tool registry
    capabilityPolicy: 'unrestricted',
    persistencePolicy: 'persist_immediately',
    description: 'Standard end-user conversation turn (conversational)',
  }),
  smart_reminder: Object.freeze({
    type: 'smart_reminder',
    canonicalType: 'smart_reminder',
    family: 'system',
    isSystemTrigger: true,
    allowedTools: Object.freeze(['get_current_time', 'get_weather', 'web_search']),
    capabilityPolicy: 'scoped',
    persistencePolicy: 'persist_on_delivery',
    description: 'Scheduled smart reminder dispatch (system notification)',
  }),
  proactive: Object.freeze({
    type: 'proactive',
    canonicalType: 'proactive',
    family: 'proactive',
    isSystemTrigger: true,
    allowedTools: Object.freeze(['get_current_time', 'get_weather', 'web_search']),
    capabilityPolicy: 'scoped',
    persistencePolicy: 'persist_on_delivery',
    description: 'Generic proactive outbound engagement',
  }),
  proactive_morning_briefing: Object.freeze({
    type: 'proactive_morning_briefing',
    canonicalType: 'proactive_morning_briefing',
    family: 'proactive',
    isSystemTrigger: true,
    allowedTools: Object.freeze(['get_current_time', 'get_weather', 'web_search']),
    capabilityPolicy: 'scoped',
    persistencePolicy: 'persist_on_delivery',
    description: 'Proactive morning briefing with weather and news info',
  }),
  proactive_reengagement: Object.freeze({
    type: 'proactive_reengagement',
    canonicalType: 'proactive_reengagement',
    family: 'proactive',
    isSystemTrigger: true,
    allowedTools: Object.freeze(['get_current_time', 'get_weather']),
    capabilityPolicy: 'scoped',
    persistencePolicy: 'persist_on_delivery',
    description: 'Proactive re-engagement after period of inactivity',
  }),
  proactive_unresolved_follow_up: Object.freeze({
    type: 'proactive_unresolved_follow_up',
    canonicalType: 'proactive_unresolved_follow_up',
    family: 'proactive',
    isSystemTrigger: true,
    allowedTools: Object.freeze(['get_current_time', 'web_search']),
    capabilityPolicy: 'scoped',
    persistencePolicy: 'persist_on_delivery',
    description: 'Proactive follow-up on unresolved queries',
  }),
  proactive_next_step_offer: Object.freeze({
    type: 'proactive_next_step_offer',
    canonicalType: 'proactive_next_step_offer',
    family: 'proactive',
    isSystemTrigger: true,
    allowedTools: Object.freeze(['get_current_time', 'web_search']),
    capabilityPolicy: 'scoped',
    persistencePolicy: 'persist_on_delivery',
    description: 'Proactive suggestion for user next steps',
  }),
  proactive_follow_up_offer: Object.freeze({
    type: 'proactive_follow_up_offer',
    canonicalType: 'proactive_follow_up_offer',
    family: 'proactive',
    isSystemTrigger: true,
    allowedTools: Object.freeze(['get_current_time']),
    capabilityPolicy: 'scoped',
    persistencePolicy: 'persist_on_delivery',
    description: 'Proactive lightweight follow-up offer',
  }),
});

export class TriggerContract {
  /**
   * Resolves any raw trigger string into a strongly typed TriggerDefinition.
   * Single Source of Truth for trigger typing and behavior throughout Craft.
   */
  public static resolveTrigger(triggerType?: string): TriggerDefinition {
    // 1. Standard conversational turn: undefined, empty string, or 'user_message'
    if (!triggerType || triggerType === 'user_message') {
      return CANONICAL_TRIGGER_DEFINITIONS.user_message;
    }

    // 2. Known canonical triggers
    if (triggerType in CANONICAL_TRIGGER_DEFINITIONS) {
      return CANONICAL_TRIGGER_DEFINITIONS[triggerType as AgentTriggerType];
    }

    // 3. Proactive family check for unknown variants / typos (e.g. proactive_reengagment, proactive:custom)
    if (
      triggerType === 'proactive' ||
      triggerType.startsWith('proactive_') ||
      triggerType.startsWith('proactive:')
    ) {
      return Object.freeze({
        type: triggerType,
        canonicalType: undefined,
        family: 'proactive',
        isSystemTrigger: true,
        allowedTools: Object.freeze([]), // Strict Default-Deny: 0 tools exposed
        capabilityPolicy: 'default_deny',
        persistencePolicy: 'persist_on_delivery',
        description: `Unrecognized proactive trigger [${triggerType}] (default-deny)`,
      });
    }

    // 4. Other unrecognized non-proactive triggers: strict Default-Deny (never unrestricted or user_message)
    return Object.freeze({
      type: triggerType,
      canonicalType: undefined,
      family: 'unknown',
      isSystemTrigger: false,
      allowedTools: Object.freeze([]), // Strict Default-Deny: 0 tools exposed
      capabilityPolicy: 'default_deny',
      persistencePolicy: 'persist_immediately',
      description: `Unrecognized trigger [${triggerType}] (default-deny)`,
    });
  }

  /**
   * Checks whether a trigger is system-initiated (e.g. smart_reminder or proactive).
   */
  public static isSystemTrigger(triggerType?: string): boolean {
    return this.resolveTrigger(triggerType).isSystemTrigger;
  }

  /**
   * Checks whether a trigger belongs to the proactive trigger family.
   */
  public static isProactiveTrigger(triggerType?: string): boolean {
    return this.resolveTrigger(triggerType).family === 'proactive';
  }

  /**
   * Checks whether a trigger is conversational (user_message).
   */
  public static isConversationalTrigger(triggerType?: string): boolean {
    return this.resolveTrigger(triggerType).family === 'conversational';
  }

  /**
   * Resolves the list of allowed tool names for a specific trigger.
   * Returns undefined for unrestricted user conversations,
   * an explicit string array for scoped system triggers,
   * or an empty array [] for default-deny triggers.
   */
  public static getAllowedTools(triggerType?: string): readonly string[] | undefined {
    return this.resolveTrigger(triggerType).allowedTools;
  }

  /**
   * Deterministic static / startup validation asserting that every registered
   * system trigger has an explicit capability policy and that all invariants hold.
   */
  public static validateTriggerCapabilityCoverage(): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // 1. Check all canonical definitions
    for (const [key, def] of Object.entries(CANONICAL_TRIGGER_DEFINITIONS)) {
      if (!def.type) {
        errors.push(`Trigger [${key}] is missing type`);
      }
      if (!def.family) {
        errors.push(`Trigger [${key}] is missing family`);
      }
      if (def.isSystemTrigger) {
        if (def.capabilityPolicy === 'unrestricted') {
          errors.push(`System trigger [${key}] must not have unrestricted capability policy`);
        }
        if (def.allowedTools === undefined) {
          errors.push(`System trigger [${key}] must have explicit allowedTools defined`);
        }
        if (def.allowedTools && def.allowedTools.length === 0 && def.capabilityPolicy !== 'default_deny') {
          errors.push(`Known system trigger [${key}] has 0 allowed tools without default_deny policy`);
        }
      }
    }

    // 2. Verify smart_reminder is present and has exact 3 tools
    const reminderDef = CANONICAL_TRIGGER_DEFINITIONS.smart_reminder;
    if (!reminderDef || !reminderDef.allowedTools || reminderDef.allowedTools.length !== 3) {
      errors.push('smart_reminder must have exactly 3 allowed tools');
    }

    // 3. Verify user_message is conversational and unrestricted
    const userMsgDef = CANONICAL_TRIGGER_DEFINITIONS.user_message;
    if (!userMsgDef || userMsgDef.family !== 'conversational' || userMsgDef.allowedTools !== undefined) {
      errors.push('user_message must be conversational with unrestricted tools');
    }

    // 4. Verify unknown proactive trigger behavior
    const unknownProactive = this.resolveTrigger('proactive_unknown_variant');
    if (unknownProactive.capabilityPolicy !== 'default_deny' || unknownProactive.allowedTools?.length !== 0) {
      errors.push('Unknown proactive trigger must resolve to default_deny with 0 tools');
    }

    // 5. Verify arbitrary unknown trigger behavior
    const unknownArbitrary = this.resolveTrigger('arbitrary_rogue_trigger');
    if (unknownArbitrary.capabilityPolicy !== 'default_deny' || unknownArbitrary.allowedTools?.length !== 0) {
      errors.push('Unknown arbitrary trigger must resolve to default_deny with 0 tools');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }
}
