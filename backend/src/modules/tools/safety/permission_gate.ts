/**
 * Tool Permission & Safety Gate (Phase 8.2)
 *
 * Enforces authorization, channel compatibility, authentication requirements,
 * and sensitive confirmation gating before a tool can be executed.
 */

import { AgentTool, ToolExecutionContext, ToolRiskLevel } from '../contracts/tool.types';
import { createToolError, ToolError } from '../contracts/error.types';

export interface ToolGateDecision {
  readonly allowed: boolean;
  readonly requiresConfirmation: boolean;
  readonly riskLevel: ToolRiskLevel;
  readonly error?: ToolError;
}

export class ToolPermissionGate {
  private static instance: ToolPermissionGate;

  public static getInstance(): ToolPermissionGate {
    if (!ToolPermissionGate.instance) {
      ToolPermissionGate.instance = new ToolPermissionGate();
    }
    return ToolPermissionGate.instance;
  }

  /**
   * Evaluates whether a tool call is authorized in the current execution context.
   */
  public evaluate(tool: AgentTool, context: ToolExecutionContext): ToolGateDecision {
    const metadata = tool.metadata || {
      name: tool.name,
      description: tool.description,
      category: 'public',
      riskLevel: tool.isSensitive ? 'high' : 'low',
      requiresConfirmation: tool.isSensitive,
      requiresNetwork: false,
    };

    // 1. Channel Restriction Gate
    if (metadata.allowedChannels && metadata.allowedChannels.length > 0) {
      if (!metadata.allowedChannels.includes(context.channel)) {
        return {
          allowed: false,
          requiresConfirmation: false,
          riskLevel: metadata.riskLevel,
          error: createToolError(
            'CHANNEL_NOT_ALLOWED',
            `Tool [${tool.name}] is not permitted on channel "${context.channel}"`,
            { userSafeMessage: `Tool ${tool.name} is not available on this platform.` }
          ),
        };
      }
    }

    // 2. Authentication Requirement Gate
    const requiresAuth =
      metadata.category === 'authenticated' ||
      metadata.category === 'mutation' ||
      metadata.category === 'memory' ||
      metadata.category === 'sensitive';

    const isAnonymous =
      !context.userId ||
      context.userId.trim() === '' ||
      context.userId.toLowerCase() === 'anonymous' ||
      context.userId.toLowerCase() === 'guest';

    if (requiresAuth && isAnonymous) {
      return {
        allowed: false,
        requiresConfirmation: false,
        riskLevel: metadata.riskLevel,
        error: createToolError(
          'UNAUTHENTICATED',
          `Tool [${tool.name}] requires an authenticated user identity`,
          { userSafeMessage: `You must be logged in to perform this action.` }
        ),
      };
    }

    // 3. Sensitive Action Confirmation Check
    const requiresConfirmation = metadata.requiresConfirmation || tool.isSensitive;

    return {
      allowed: true,
      requiresConfirmation,
      riskLevel: metadata.riskLevel,
    };
  }
}
