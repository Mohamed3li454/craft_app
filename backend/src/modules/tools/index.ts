/**
 * Tool Intelligence & Safety Module (Phase 8.2)
 *
 * Public API for Craft's deterministic Tool Safety Lifecycle:
 * - Strongly typed contracts & metadata
 * - Schema validation & SSRF protection
 * - Permission & safety gates
 * - Output sanitization, data/control separation & token budget bounding
 * - Result formatting & decoupled prompt synthesis
 * - Centralized Tool Lifecycle Manager & Registry
 */

// Contracts & Error Types
export * from './contracts/tool.types';
export * from './contracts/error.types';
export * from './tool.interface';

// Validation & SSRF Guard
export * from './validation/url_validator';
export * from './validation/input_validator';

// Safety Gates & Output Sanitization
export * from './safety/permission_gate';
export * from './safety/output_sanitizer';
export * from './safety/tool_capability_policy';
export * from './safety/trigger_contract';

// Adapters & Formatting
export * from './adapters/tool_result_formatter';

// Lifecycle Management & Registry
export * from './lifecycle/tool_lifecycle';
export * from './registry';

// Built-in Tools
export * from './builtins/time.tool';
export * from './builtins/echo.tool';
export * from './builtins/weather.tool';
export * from './builtins/search.tool';
export * from './builtins/reminder.tool';
export * from './builtins/memory.tool';
