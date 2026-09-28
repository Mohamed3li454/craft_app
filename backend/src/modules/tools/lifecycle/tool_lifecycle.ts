/**
 * Tool Lifecycle Manager (Phase 8.2)
 *
 * Orchestrates the full deterministic tool execution lifecycle:
 * Resolve -> Permission Gate -> Input Validation -> Safe Execution ->
 * Output Sanitization -> Token Budgeting -> Formatted Result
 */

import { logger } from '../../../core/logger';
import { config } from '../../../config/env';
import { AgentTool, ToolExecutionContext, TrustLevel } from '../contracts/tool.types';
import { createToolError, ToolError } from '../contracts/error.types';
import { ToolRegistry } from '../registry';
import { ToolPermissionGate } from '../safety/permission_gate';
import { ToolInputValidator } from '../validation/input_validator';
import { ToolOutputSanitizer, SanitizedOutputResult } from '../safety/output_sanitizer';
import { MetricsCollector } from '../../observability';

export type LifecycleStatus =
  | 'completed'
  | 'failed'
  | 'denied'
  | 'confirmation_required';

export interface LifecycleExecutionResult {
  readonly status: LifecycleStatus;
  readonly toolName: string;
  readonly tool?: AgentTool;
  readonly validatedArgs?: Record<string, any>;
  readonly rawResult?: any;
  readonly sanitized?: SanitizedOutputResult;
  readonly serializedForLLM?: string;
  readonly trustLevel?: TrustLevel;
  readonly error?: ToolError;
  readonly durationMs: number;
}

export class ToolLifecycleManager {
  private static instance: ToolLifecycleManager;

  public static getInstance(): ToolLifecycleManager {
    if (!ToolLifecycleManager.instance) {
      ToolLifecycleManager.instance = new ToolLifecycleManager();
    }
    return ToolLifecycleManager.instance;
  }

  constructor(
    private registry: ToolRegistry = ToolRegistry.getInstance(),
    private permissionGate: ToolPermissionGate = ToolPermissionGate.getInstance(),
    private sanitizer: ToolOutputSanitizer = ToolOutputSanitizer.getInstance()
  ) {}

  /**
   * Executes a tool through the full safety and verification lifecycle.
   */
  public async execute(
    toolName: string,
    rawArgs: unknown,
    context: ToolExecutionContext
  ): Promise<LifecycleExecutionResult> {
    const startTime = Date.now();
    const metrics = MetricsCollector.getInstance();
    metrics.increment('craft.tool.calls', 1, { tool: toolName, channel: context.channel });

    // 1. Tool Resolution
    const tool = this.registry.getTool(toolName);
    if (!tool) {
      logger.warn(`Tool not found in registry: [${toolName}]`);
      const error = createToolError(
        'TOOL_NOT_FOUND',
        `Tool [${toolName}] not found in registry`,
        { userSafeMessage: `The requested action "${toolName}" is not available.` }
      );
      metrics.increment('craft.tool.failures', 1, { tool: toolName, errorCategory: error.code });
      return {
        status: 'failed',
        toolName,
        error,
        durationMs: Date.now() - startTime,
      };
    }

    // 2. Permission & Safety Gate
    const gateDecision = this.permissionGate.evaluate(tool, context);
    if (!gateDecision.allowed) {
      logger.warn(`Permission denied for tool [${toolName}] on channel [${context.channel}]`, {
        error: gateDecision.error?.message,
      });
      metrics.increment('craft.tool.failures', 1, { tool: toolName, errorCategory: gateDecision.error?.code || 'PERMISSION_DENIED' });
      return {
        status: 'denied',
        toolName,
        tool,
        error: gateDecision.error,
        durationMs: Date.now() - startTime,
      };
    }

    // 3. Input Validation (runs before sensitive confirmation to ensure args are valid)
    const validationResult = ToolInputValidator.validate(tool, rawArgs);
    if (!validationResult.success) {
      logger.warn(`Validation failed for tool [${toolName}] arguments`, {
        error: validationResult.error.message,
      });
      metrics.increment('craft.tool.failures', 1, { tool: toolName, errorCategory: validationResult.error.code });
      return {
        status: 'failed',
        toolName,
        tool,
        error: validationResult.error,
        durationMs: Date.now() - startTime,
      };
    }

    const validatedArgs = validationResult.data;

    // 4. Sensitive Action Confirmation Gate
    if (gateDecision.requiresConfirmation) {
      logger.info(`Tool [${toolName}] requires explicit confirmation`);
      metrics.increment('craft.tool.confirmations', 1, { tool: toolName, channel: context.channel });
      return {
        status: 'confirmation_required',
        toolName,
        tool,
        validatedArgs,
        durationMs: Date.now() - startTime,
      };
    }

    // 5. Execution with Timeout Safety
    const timeoutMs = tool.metadata?.maxExecutionMs || config.security.toolTimeoutMs || 10000;
    const timeoutPromise = new Promise<{ success: false; error: ToolError }>((_, reject) =>
      setTimeout(
        () =>
          reject(
            createToolError(
              'TIMEOUT_ERROR',
              `Tool [${toolName}] execution timed out after ${timeoutMs}ms`,
              { retryable: true, userSafeMessage: `The action timed out. Please try again.` }
            )
          ),
        timeoutMs
      )
    );

    let rawExecutionOutput: any;
    try {
      logger.info(`Executing tool [${toolName}] through lifecycle`, { args: validatedArgs });
      const execResult = await Promise.race([
        tool.execute(validatedArgs, context),
        timeoutPromise,
      ]);

      if (!execResult.success) {
        const error = typeof execResult.error === 'object' && execResult.error
          ? (execResult.error as ToolError)
          : createToolError('EXECUTION_FAILED', String(execResult.error || 'Execution returned unsuccessful'));
        const durationMs = Date.now() - startTime;
        metrics.increment('craft.tool.failures', 1, { tool: toolName, errorCategory: error.code });
        metrics.observe('craft.tool.latency', durationMs, { tool: toolName, status: 'error' });
        return {
          status: 'failed',
          toolName,
          tool,
          validatedArgs,
          error,
          durationMs,
        };
      }

      rawExecutionOutput = execResult.output;
    } catch (err: any) {
      logger.error(`Exception during tool [${toolName}] execution`, { error: err.message });
      const error = err.code
        ? err
        : createToolError('EXECUTION_FAILED', err.message || 'Tool execution threw an exception');
      const durationMs = Date.now() - startTime;
      metrics.increment('craft.tool.failures', 1, { tool: toolName, errorCategory: error.code });
      if (error.code === 'TIMEOUT_ERROR') {
        metrics.increment('craft.tool.timeouts', 1, { tool: toolName });
      }
      metrics.observe('craft.tool.latency', durationMs, { tool: toolName, status: 'error' });
      return {
        status: 'failed',
        toolName,
        tool,
        validatedArgs,
        error,
        durationMs,
      };
    }

    // 6. Output Sanitization & Token Budgeting
    const sanitized = this.sanitizer.sanitize(
      tool,
      { success: true, output: rawExecutionOutput },
      context.budget
    );

    const durationMs = Date.now() - startTime;
    metrics.observe('craft.tool.latency', durationMs, { tool: toolName, status: 'success' });
    logger.info(`Tool [${toolName}] completed lifecycle in ${durationMs}ms`, {
      truncated: sanitized.truncated,
      tokens: sanitized.estimatedTokens,
    });

    return {
      status: 'completed',
      toolName,
      tool,
      validatedArgs,
      rawResult: rawExecutionOutput,
      sanitized,
      serializedForLLM: sanitized.serializedForLLM,
      trustLevel: sanitized.trustLevel,
      durationMs,
    };
  }
}
