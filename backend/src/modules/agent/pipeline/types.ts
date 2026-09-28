/**
 * Agent Pipeline Types & Context Definitions (Phase 8.1)
 *
 * Defines the pipeline contracts, per-stage lifecycle context,
 * dependencies interface, and input/output contracts.
 */

import { GroqProvider } from '../../groq/groq.provider';
import { AIRouter, AIProvider } from '../../ai';
import { ToolRegistry } from '../../tools/registry';
import { ToolLifecycleManager } from '../../tools/lifecycle/tool_lifecycle';
import { ExecutionEngine } from '../execution/execution_engine';
import { ConfirmationService } from '../../confirmation/confirmation.service';
import { ChatRepository } from '../../../database/repositories/chat.repo';
import { MemoryRepository } from '../../../database/repositories/memory.repo';
import { UserRepository } from '../../../database/repositories/user.repo';
import { UserPreferenceRepository } from '../../../database/repositories/user_preference.repo';
import { MessageEntity } from '../../../database/repositories/types';
import { LanguageContext } from '../../language';
import { PersonalityContext, ExplicitPersonalityPreference } from '../../personality';
import { PersonalizationPolicy } from '../../personalization';
import { ConversationState } from '../../conversation';
import { MemoryContext } from '../../memory';
import { AdaptiveResponsePolicy } from '../../response';
import { ProactivePolicy } from '../../proactive';
import { BudgetAllocationResult, TokenBudgetManager } from '../../context';

export interface AgentMediaAttachment {
  buffer: Buffer;
  mimeType: string;
  filename?: string;
}

export interface AgentRunInput {
  userId: string;
  userPhone?: string;
  userName?: string;
  conversationId?: string;
  channel: 'flutter' | 'whatsapp';
  text: string;
  mediaUrl?: string;
  media?: AgentMediaAttachment;
  onInterimProgress?: (message: string) => Promise<void> | void;
  explicitPersonalityPreference?: ExplicitPersonalityPreference;
  correlationId?: string;
}

export interface AgentRunOutput {
  conversationId: string;
  agentRunId: string;
  status: 'completed' | 'waiting_for_confirmation' | 'failed';
  replyText: string;
  toolCallsExecuted: Array<{
    toolName: string;
    arguments: Record<string, any>;
    result: any;
  }>;
  confirmationRequest?: {
    token: string;
    actionName: string;
    description: string;
    expiresAt: string;
  };
  metrics?: {
    modelUsed: string;
    latencyMs: number;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  languageContext?: LanguageContext;
  personalityContext?: PersonalityContext;
  conversationState?: ConversationState;
  adaptiveResponsePolicy?: AdaptiveResponsePolicy;
  proactivePolicy?: ProactivePolicy;
}

export interface AgentPipelineDependencies {
  aiRouter?: AIRouter;
  aiProvider?: AIProvider;
  groqProvider: GroqProvider;
  toolRegistry: ToolRegistry;
  confirmationService: ConfirmationService;
  chatRepo: ChatRepository;
  memoryRepo: MemoryRepository;
  userRepo: UserRepository;
  userPreferenceRepo: UserPreferenceRepository;
  tokenBudgetManager: TokenBudgetManager;
  toolLifecycleManager?: ToolLifecycleManager;
  executionEngine?: ExecutionEngine;
}

export interface AgentPipelineContext {
  // Runtime input & identity
  readonly input: AgentRunInput;
  readonly correlationId?: string;
  readonly agentRunId: string;
  readonly startTime: number;
  readonly cleanUserText: string;

  // Preflight properties
  channel: 'flutter' | 'whatsapp';
  conversationId: string;
  textToProcess: string;
  mediaType: string;
  isAudio: boolean;
  isImage: boolean;
  imageAttachment?: { data: string; mimeType: string };
  effectivePrompt: string;
  historyRecordText: string;
  interimSent: boolean;
  sendInterim: (msg: string) => Promise<void>;

  // Cognitive & Policy context
  languageContext: LanguageContext;
  personalityContext: PersonalityContext;
  recentMessages: MessageEntity[];
  conversationState?: ConversationState;
  memoryContext?: MemoryContext;
  personalizationPolicy?: PersonalizationPolicy;
  adaptiveResponsePolicy?: AdaptiveResponsePolicy;
  proactivePolicy?: ProactivePolicy;
  tokenBudgetResult?: BudgetAllocationResult;

  // Execution state
  toolCallsExecuted: AgentRunOutput['toolCallsExecuted'];
  confirmationRequest?: AgentRunOutput['confirmationRequest'];
  finalReply: string;
  lastModelUsed: string;
  lastProviderUsed?: string;
  accumulatedPromptTokens: number;
  accumulatedCompletionTokens: number;
  accumulatedTotalTokens: number;
  status: 'completed' | 'waiting_for_confirmation' | 'failed';

  // Early-exit bypass (e.g. Cache Hit or Daily Limit Exceeded)
  earlyExitOutput?: AgentRunOutput;
}

export interface PipelineStage {
  readonly name: string;
  execute(ctx: AgentPipelineContext, deps: AgentPipelineDependencies): Promise<void>;
}
