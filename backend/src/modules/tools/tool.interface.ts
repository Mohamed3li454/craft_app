import { LanguageContext } from '../language/types';

export interface ToolContext {
  userId: string;
  conversationId: string;
  channel: 'flutter' | 'whatsapp';
  languageContext?: LanguageContext;
}

export interface ToolExecutionResult {
  success: boolean;
  output?: any;
  error?: string;
  isSensitive?: boolean;
  confirmationDescription?: string;
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

export interface AgentTool {
  name: string;
  description: string;
  parameters: ToolParametersSchema;
  isSensitive: boolean; // Whether executing this tool requires explicit user confirmation
  execute(args: Record<string, any>, context: ToolContext): Promise<ToolExecutionResult>;
}
