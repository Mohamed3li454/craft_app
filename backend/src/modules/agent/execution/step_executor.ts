/**
 * Step Executor (Phase 8.3)
 *
 * Dispatches individual execution steps STRICTLY through ToolLifecycleManager.
 * Invariant: Never executes a tool directly; every single step is subject to:
 * Permission Gate -> Schema Validation -> SSRF Guard -> Sanitization -> Token Bounding.
 */

import { logger } from '../../../core/logger';
import { ToolLifecycleManager, LifecycleExecutionResult } from '../../tools/lifecycle/tool_lifecycle';
import { ToolExecutionContext } from '../../tools/contracts/tool.types';
import { createToolError } from '../../tools/contracts/error.types';
import { ExecutionEngineContext } from './types';

export class StepExecutor {
  constructor(
    private lifecycleManager: ToolLifecycleManager = ToolLifecycleManager.getInstance()
  ) {}

  /**
   * Executes a single tool call securely through the Tool Safety Lifecycle.
   */
  public async executeStep(
    toolName: string,
    args: Record<string, any>,
    context: ExecutionEngineContext
  ): Promise<LifecycleExecutionResult> {
    // 1. Cancellation Check
    if (context.abortSignal?.aborted) {
      logger.warn(`Execution step aborted by cancellation signal before [${toolName}]`);
      return {
        status: 'failed',
        toolName,
        error: createToolError('INTERNAL_ERROR', 'Execution was aborted by cancellation signal.', {
          userSafeMessage: 'The operation was cancelled.',
        }),
        durationMs: 0,
      };
    }

    // 2. Prepare ToolExecutionContext
    const toolContext: ToolExecutionContext = {
      runId: context.runId,
      userId: context.userId,
      conversationId: context.conversationId,
      channel: context.channel,
      languageContext: context.languageContext,
      signal: context.abortSignal,
      budget: context.tokenBudgetResult
        ? {
            maxOutputChars: context.tokenBudgetResult.maxToolResultChars,
          }
        : undefined,
    };

    logger.info(`StepExecutor invoking [${toolName}] through ToolLifecycleManager`, {
      runId: context.runId,
      channel: context.channel,
    });

    // 3. Delegate strictly to ToolLifecycleManager
    return await this.lifecycleManager.execute(toolName, args, toolContext);
  }
}
