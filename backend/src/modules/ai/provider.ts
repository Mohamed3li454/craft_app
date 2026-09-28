/**
 * AI Provider Core Contract (Phase 8.4)
 *
 * Defines the vendor-neutral contract that every AI model provider implementation
 * (Groq, OpenAI, Mock, etc.) must fulfill.
 */

import {
  AICapability,
  AIModelProfile,
  AIRequest,
  AIResponse,
} from './types';
import { ProviderHealth } from './health';

export interface AIProvider {
  /**
   * Unique lowercase identifier for the provider (e.g. 'groq', 'mock', 'openai')
   */
  readonly id: string;

  /**
   * Executes a model generation or tool planning request and returns normalized AIResponse.
   */
  generate(request: AIRequest): Promise<AIResponse>;

  /**
   * Checks whether the provider supports a specific capability (e.g. 'tools', 'vision').
   */
  supports(capability: AICapability): boolean;

  /**
   * Returns current health and circuit state for the provider.
   */
  health(): ProviderHealth;

  /**
   * Returns the model catalog and capability profiles supported by this provider.
   */
  getModelProfiles(): AIModelProfile[];

  /**
   * Returns the primary default model identifier for this provider.
   */
  getDefaultModel(): string;
}
