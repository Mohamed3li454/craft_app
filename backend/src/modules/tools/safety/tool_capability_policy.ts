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
   * Resolves the list of allowed tool names for a specific trigger type.
   * Returns undefined if the trigger type has unrestricted access (e.g. user_message).
   */
  public getAllowedTools(triggerType?: string): readonly string[] | undefined {
    if (triggerType === 'smart_reminder') {
      return SMART_REMINDER_ALLOWED_TOOLS;
    }
    // user_message and default triggers are unrestricted
    return undefined;
  }

  /**
   * Evaluates if a given tool is permitted under the specified trigger type.
   */
  public isToolAllowed(toolName: string, triggerType?: string): CapabilityEvaluationResult {
    const capability = DEFAULT_TOOL_CAPABILITIES[toolName] || 'external_side_effect';
    const metrics = MetricsCollector.getInstance();

    // 1. Unrestricted triggers (default user conversations)
    if (!triggerType || triggerType === 'user_message') {
      metrics.increment('craft.tool.policy.allowed', 1, {
        triggerType: triggerType || 'user_message',
        toolName,
        decision: 'allowed',
      });
      return { allowed: true, toolName, triggerType, capability };
    }

    // 2. Smart Reminder Trigger Enforcement
    if (triggerType === 'smart_reminder') {
      const isExplicitlyForbidden = SMART_REMINDER_FORBIDDEN_TOOLS.includes(toolName);
      const isExplicitlyAllowed = SMART_REMINDER_ALLOWED_TOOLS.includes(toolName);

      if (isExplicitlyForbidden || !isExplicitlyAllowed) {
        logger.warn('[ToolCapabilityPolicy] Tool execution denied by trigger capability policy', {
          toolName,
          triggerType,
          capability,
          toolPolicyDecision: 'denied',
          toolPolicyReason: 'TOOL_NOT_ALLOWED_FOR_TRIGGER',
        });

        metrics.increment('craft.tool.policy.denied', 1, {
          triggerType,
          toolName,
          decision: 'denied',
          reason: 'TOOL_NOT_ALLOWED_FOR_TRIGGER',
        });

        return {
          allowed: false,
          reason: 'TOOL_NOT_ALLOWED_FOR_TRIGGER',
          toolName,
          triggerType,
          capability,
        };
      }

      metrics.increment('craft.tool.policy.allowed', 1, {
        triggerType,
        toolName,
        decision: 'allowed',
      });
      return { allowed: true, toolName, triggerType, capability };
    }

    // Other triggers default to allowed (preserving existing behavior)
    metrics.increment('craft.tool.policy.allowed', 1, {
      triggerType,
      toolName,
      decision: 'allowed',
    });
    return { allowed: true, toolName, triggerType, capability };
  }

  /**
   * Filters an array of AgentTool instances based on the trigger type capability policy.
   */
  public filterTools(tools: AgentTool[], triggerType?: string): AgentTool[] {
    const allowedNames = this.getAllowedTools(triggerType);
    if (!allowedNames) {
      return tools;
    }
    const filtered = tools.filter((tool) => allowedNames.includes(tool.name));

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
