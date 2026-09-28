/**
 * Tool Interfaces (Phase 8.2 Compatibility Facade)
 *
 * Re-exports modernized contracts while maintaining 100% backward
 * compatibility for existing tools, tests, and consumers.
 */

export * from './contracts/tool.types';
export * from './contracts/error.types';

import {
  AgentTool,
  ToolExecutionContext,
  ToolExecutionResult,
  ToolParameterProperty,
  ToolParametersSchema,
} from './contracts/tool.types';

// Backward-compatible alias
export type ToolContext = ToolExecutionContext;
export { AgentTool, ToolExecutionResult, ToolParameterProperty, ToolParametersSchema };
