/**
 * Tool Capability Policy (Phase 13.2)
 *
 * Implements granular capability-based tool access control per trigger type:
 * - Scopes available tool manifests before planner/LLM invocation
 * - Enforces zero-leak boundary for system triggers (e.g. smart_reminder)
 * - Acts as first line of defense; works in tandem with ToolLifecycleManager
 * - Emits low-cardinality observability telemetry and monotonic metrics
 */

import { logger } from '../../../core/logger';
import { MetricsCollector } from '../../observability';
import { AgentTool } from '../contracts/tool.types';
import { ToolRegistry } from '../registry';
import { TriggerContract } from './trigger_contract';
import { RuntimePolicyResolver } from '../../../config/runtime_policy';

export type AgentCapability =
  | 'informational'
  | 'memory_read'
  | 'memory_write'
  | 'reminder_read'
  | 'reminder_write'
  | 'messaging'
  | 'proactive'
  | 'external_side_effect';

/**
 * Standard classification of Craft tools into capabilities.
 */
export const DEFAULT_TOOL_CAPABILITIES: Record<string, AgentCapability> = {
  get_current_time: 'informational',
  get_weather: 'informational',
  web_search: 'informational',
  echo_message: 'informational',
  list_reminders: 'reminder_read',
  create_reminder: 'reminder_write',
  complete_reminder: 'reminder_write',
  save_memory: 'memory_write',
};

/**
 * Explicit allowlist of tool names permitted during Smart Reminder execution.
 * Smart reminders are informational notifications and must never trigger mutations.
 */
export const SMART_REMINDER_ALLOWED_TOOLS: readonly string[] = Object.freeze([
  'get_current_time',
  'get_weather',
  'web_search',
]);

/**
 * Explicit denylist of forbidden tools during Smart Reminder execution.
 */
export const SMART_REMINDER_FORBIDDEN_TOOLS: readonly string[] = Object.freeze([
  'create_reminder',
  'cancel_reminder',
  'complete_reminder',
  'save_memory',
  'delete_memory',
  'send_message',
  'whatsapp_outbound',
  'dispatch_proactive',
  'mutate_conversation',
  'execute_payment',
  'confirm_action',
]);

/**
 * Explicit map of permitted tool names per proactive trigger type (Phase 13.3).
 * Follows principle of least privilege: strictly informational tools only.
 */
export const PROACTIVE_CAPABILITY_POLICIES: Record<string, readonly string[]> = Object.freeze({
  proactive: Object.freeze(['get_current_time', 'get_weather', 'web_search']),
  proactive_morning_briefing: Object.freeze(['get_current_time', 'get_weather', 'web_search']),
  proactive_reengagement: Object.freeze(['get_current_time', 'get_weather']),
  proactive_unresolved_follow_up: Object.freeze(['get_current_time', 'web_search']),
  proactive_next_step_offer: Object.freeze(['get_current_time', 'web_search']),
  proactive_follow_up_offer: Object.freeze(['get_current_time']),
});

/**
 * Explicit denylist of forbidden tools during all Proactive executions.
 * Proactive generation must NEVER mutate user state, send out-of-band messages,
 * or cause recursive proactive dispatches.
 */
export const PROACTIVE_FORBIDDEN_TOOLS: readonly string[] = Object.freeze([
  'create_reminder',
  'cancel_reminder',
  'complete_reminder',
  'save_memory',
  'delete_memory',
  'send_message',
  'whatsapp_outbound',
  'dispatch_proactive',
  'mutate_conversation',
  'execute_payment',
  'confirm_action',
]);

export interface CapabilityEvaluationResult {
  readonly allowed: boolean;
  readonly reason?: string;
  readonly toolName: string;
  readonly triggerType?: string;
  readonly capability?: AgentCapability;
}

export class ToolCapabilityPolicy {
  private static instance: ToolCapabilityPolicy;

  public static getInstance(): ToolCapabilityPolicy {
    if (!ToolCapabilityPolicy.instance) {
      ToolCapabilityPolicy.instance = new ToolCapabilityPolicy();
    }
    return ToolCapabilityPolicy.instance;
  }

  /**
   * Helper to detect whether a trigger belongs to the proactive family.
   * Delegates to Canonical TriggerContract.
   */
  public isProactiveTrigger(triggerType?: string): boolean {
    return TriggerContract.isProactiveTrigger(triggerType);
  }

  /**
   * Resolves the list of allowed tool names for a specific trigger type.
   * Delegates to Canonical TriggerContract.
   */
  public getAllowedTools(triggerType?: string): readonly string[] | undefined {
    const rawAllowed = TriggerContract.getAllowedTools(triggerType);
    if (!rawAllowed) {
      return undefined;
    }
    if (!RuntimePolicyResolver.getPolicy().searchEnabled) {
      return rawAllowed.filter((name) => name !== 'web_search');
    }
    return rawAllowed;
  }

  /**
   * Evaluates if a given tool is permitted under the specified trigger type.
   * Enforces canonical trigger definitions, explicit allowed sets, and defense-in-depth denylists.
   */
  public isToolAllowed(toolName: string, triggerType?: string): CapabilityEvaluationResult {
    const capability = DEFAULT_TOOL_CAPABILITIES[toolName] || 'external_side_effect';
    const metrics = MetricsCollector.getInstance();
    const resolved = TriggerContract.resolveTrigger(triggerType);

    // 0. Runtime Policy: searchEnabled check
    if (toolName === 'web_search' && !RuntimePolicyResolver.getPolicy().searchEnabled) {
      logger.warn('[ToolCapabilityPolicy] Tool execution denied: search is disabled by runtime policy', {
        toolName,
        triggerType: resolved.type,
        family: resolved.family,
        capability,
        toolPolicyDecision: 'denied',
        toolPolicyReason: 'SEARCH_DISABLED_BY_POLICY',
      });

      metrics.increment('craft.tool.policy.denied', 1, {
        triggerType: resolved.type,
        toolName,
        decision: 'denied',
        reason: 'SEARCH_DISABLED_BY_POLICY',
        triggerFamily: resolved.family,
      });

      return {
        allowed: false,
        reason: 'SEARCH_DISABLED_BY_POLICY',
        toolName,
        triggerType: resolved.type,
        capability,
      };
    }

    // 1. Unrestricted triggers (default user conversations)
    if (resolved.capabilityPolicy === 'unrestricted') {
      metrics.increment('craft.tool.policy.allowed', 1, {
        triggerType: triggerType || 'user_message',
        toolName,
        decision: 'allowed',
        triggerFamily: resolved.family,
      });
      return { allowed: true, toolName, triggerType: resolved.type, capability };
    }

    // 2. Strict Default-Deny triggers (unknown proactive or unrecognized triggers)
    if (resolved.capabilityPolicy === 'default_deny') {
      logger.warn('[ToolCapabilityPolicy] Tool execution denied by default-deny trigger policy', {
        toolName,
        triggerType: resolved.type,
        family: resolved.family,
        capability,
        toolPolicyDecision: 'denied',
        toolPolicyReason: 'TOOL_NOT_ALLOWED_FOR_TRIGGER',
      });

      metrics.increment('craft.tool.policy.denied', 1, {
        triggerType: resolved.type,
        toolName,
        decision: 'denied',
        reason: 'TOOL_NOT_ALLOWED_FOR_TRIGGER',
        triggerFamily: resolved.family,
      });

      return {
        allowed: false,
        reason: 'TOOL_NOT_ALLOWED_FOR_TRIGGER',
        toolName,
        triggerType: resolved.type,
        capability,
      };
    }

    // 3. Scoped system triggers (smart_reminder and known proactive variants)
    const allowedTools = resolved.allowedTools || [];
    const forbiddenTools =
      resolved.canonicalType === 'smart_reminder'
        ? SMART_REMINDER_FORBIDDEN_TOOLS
        : PROACTIVE_FORBIDDEN_TOOLS;

    const isExplicitlyForbidden = forbiddenTools.includes(toolName);
    const isExplicitlyAllowed = allowedTools.includes(toolName);

    if (isExplicitlyForbidden || !isExplicitlyAllowed) {
      logger.warn('[ToolCapabilityPolicy] Tool execution denied by trigger capability policy', {
        toolName,
        triggerType: resolved.type,
        family: resolved.family,
        capability,
        toolPolicyDecision: 'denied',
        toolPolicyReason: 'TOOL_NOT_ALLOWED_FOR_TRIGGER',
      });

      metrics.increment('craft.tool.policy.denied', 1, {
        triggerType: resolved.type,
        toolName,
        decision: 'denied',
        reason: 'TOOL_NOT_ALLOWED_FOR_TRIGGER',
        triggerFamily: resolved.family,
      });

      return {
        allowed: false,
        reason: 'TOOL_NOT_ALLOWED_FOR_TRIGGER',
        toolName,
        triggerType: resolved.type,
        capability,
      };
    }

    metrics.increment('craft.tool.policy.allowed', 1, {
      triggerType: resolved.type,
      toolName,
      decision: 'allowed',
      triggerFamily: resolved.family,
    });
    return { allowed: true, toolName, triggerType: resolved.type, capability };
  }

  /**
   * Filters an array of AgentTool instances based on the trigger type capability policy.
   */
  public filterTools(tools: AgentTool[], triggerType?: string): AgentTool[] {
    let candidateTools = tools;
    if (!RuntimePolicyResolver.getPolicy().searchEnabled) {
      candidateTools = candidateTools.filter((tool) => tool.name !== 'web_search');
    }
    const allowedNames = this.getAllowedTools(triggerType);
    if (!allowedNames) {
      return candidateTools;
    }
    const filtered = candidateTools.filter((tool) => allowedNames.includes(tool.name));

    logger.debug('[ToolCapabilityPolicy] Filtered tools manifest', {
      triggerType,
      originalCount: tools.length,
      allowedToolCount: filtered.length,
      allowedTools: filtered.map((t) => t.name),
    });

    return filtered;
  }

  /**
   * Transforms registered tools into OpenAI / Groq standard Tool format,
   * strictly filtered by the trigger capability policy BEFORE passing to planner or LLM.
   */
  public getFilteredOpenAITools(registry: ToolRegistry, triggerType?: string): any[] {
    const allTools = registry.getAllTools();
    const filteredTools = this.filterTools(allTools, triggerType);

    if (triggerType === 'smart_reminder') {
      logger.info('[ToolCapabilityPolicy] Enforced tool manifest scoping for smart_reminder', {
        triggerType,
        allowedToolCount: filteredTools.length,
        allowedTools: filteredTools.map((t) => t.name),
      });
    } else if (this.isProactiveTrigger(triggerType)) {
      logger.info('[ToolCapabilityPolicy] Enforced tool manifest scoping for proactive trigger', {
        triggerType,
        allowedToolCount: filteredTools.length,
        allowedTools: filteredTools.map((t) => t.name),
      });
    }

    return filteredTools.map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: {
          type: 'object',
          properties: Object.entries(tool.parameters.properties).reduce(
            (acc, [key, prop]) => {
              acc[key] = {
                type: (prop.type || 'string').toLowerCase(),
                description: prop.description,
              };
              return acc;
            },
            {} as Record<string, any>
          ),
          required: tool.parameters.required || [],
        },
      },
    }));
  }
}
