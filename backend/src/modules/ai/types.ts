/**
 * Provider-Neutral AI Contracts (Phase 8.4)
 *
 * Defines strongly-typed, provider-agnostic data models for requests, responses,
 * messages, tool calling, model capabilities, and usage metrics across all AI providers.
 */

export type AIMessageRole = 'system' | 'user' | 'assistant' | 'tool';

export type AIMessageContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export interface AIToolCallFunction {
  name: string;
  arguments: Record<string, any>;
  rawArguments?: string;
}

export interface AIToolCall {
  id: string;
  type: 'function';
  function: AIToolCallFunction;
}

export interface AIMessage {
  role: AIMessageRole;
  content?: string | AIMessageContentPart[];
  name?: string;
  toolCallId?: string;
  toolCalls?: AIToolCall[];
}

export interface AIToolDefinition {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, any>;
  };
}

export type AIToolChoice =
  | 'auto'
  | 'none'
  | 'required'
  | { type: 'function'; function: { name: string } };

export type AIFinishReason =
  | 'stop'
  | 'tool_calls'
  | 'length'
  | 'content_filter'
  | 'error'
  | 'unknown';

export interface AIUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedTokens?: number;
}

export type AICapability =
  | 'tools'
  | 'vision'
  | 'audio_transcription'
  | 'streaming'
  | 'system_instruction';

export interface AIModelProfile {
  providerId: string;
  modelId: string;
  contextWindow: number;
  maxOutputTokens: number;
  supportsTools: boolean;
  supportsVision: boolean;
  supportsStreaming: boolean;
  capabilities: AICapability[];
  isDefault?: boolean;
}

export interface AIRequestMetadata {
  userId?: string;
  conversationId?: string;
  channel?: string;
  runId?: string;
  step?: number;
}

export interface AIRequest {
  messages: AIMessage[];
  tools?: AIToolDefinition[];
  toolChoice?: AIToolChoice;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  metadata?: AIRequestMetadata;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface AIResponse {
  providerId: string;
  model: string;
  message: AIMessage;
  toolCalls: AIToolCall[];
  finishReason: AIFinishReason;
  usage?: AIUsage;
  latencyMs: number;
  requestId?: string;
  rawResponse?: any;
}
