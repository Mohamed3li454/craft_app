/**
 * Tool Contract & Metadata Types (Phase 8.2)
 *
 * Defines strongly-typed tool contracts, execution contexts, metadata,
 * risk classifications, and structured execution results.
 */

import { z } from 'zod';
import { LanguageContext } from '../../language/types';
import { ToolError } from './error.types';

export type ToolCategory =
  | 'public'
  | 'authenticated'
  | 'sensitive'
  | 'external_network'
  | 'mutation'
  | 'memory';

export type ToolRiskLevel = 'low' | 'medium' | 'high' | 'critical';

export type TrustLevel = 'trusted' | 'user_provided' | 'untrusted_external';

export interface ToolMetadata {
  readonly name: string;
  readonly description: string;
  readonly category: ToolCategory;
  readonly riskLevel: ToolRiskLevel;
  readonly requiresConfirmation: boolean;
  readonly requiresNetwork: boolean;
  readonly maxExecutionMs?: number;
  readonly maxOutputTokens?: number;
  readonly maxOutputChars?: number;
  readonly allowedChannels?: readonly ('flutter' | 'whatsapp')[];
}

export interface ToolParameterProperty {
  type: string;
  description: string;
  enum?: string[];
}

export interface ToolParametersSchema {
  type: 'object';
  properties: Record<string, ToolParameterProperty>;
  required?: string[];
}

export interface ToolExecutionContext {
  readonly runId?: string;
  readonly userId: string;
  readonly conversationId: string;
  readonly channel: 'flutter' | 'whatsapp';
  readonly languageContext?: LanguageContext;
  readonly signal?: AbortSignal;
  readonly triggerType?: string;
  readonly budget?: {
    maxOutputTokens?: number;
    maxOutputChars?: number;
  };
  readonly metadata?: Record<string, unknown>;
}

export interface ToolExecutionResult<T = any> {
  readonly success: boolean;
  readonly output?: T;
  readonly error?: string | ToolError;
  readonly isSensitive?: boolean;
  readonly confirmationDescription?: string;
  readonly metadata?: {
    readonly source?: string;
    readonly trustLevel?: TrustLevel;
    readonly truncated?: boolean;
    readonly originalSize?: number;
    readonly finalSize?: number;
    readonly estimatedTokens?: number;
  };
}

export interface AgentTool<TArgs = any, TResult = any> {
  readonly name: string;
  readonly description: string;
  readonly parameters: ToolParametersSchema;
  readonly schema?: z.ZodType<TArgs>;
  readonly metadata?: ToolMetadata;
  readonly isSensitive: boolean; // Backward-compatible boolean check
  execute(args: TArgs, context: ToolExecutionContext): Promise<ToolExecutionResult<TResult>>;
}
