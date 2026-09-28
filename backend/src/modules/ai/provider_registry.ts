/**
 * AI Provider Registry (Phase 8.4)
 *
 * Central registry holding configured AIProvider implementations.
 * Prevents arbitrary, fragmented provider instantiations across the codebase.
 */

import { AIProvider } from './provider';
import { GroqAIProvider } from './providers/groq/provider';
import { logger } from '../../core/logger';

export class ProviderRegistry {
  private static instance: ProviderRegistry;
  private providers: Map<string, AIProvider> = new Map();

  constructor() {
    // Automatically register default Groq provider
    this.registerProvider(new GroqAIProvider());
  }

  public static getInstance(): ProviderRegistry {
    if (!ProviderRegistry.instance) {
      ProviderRegistry.instance = new ProviderRegistry();
    }
    return ProviderRegistry.instance;
  }

  public registerProvider(provider: AIProvider): void {
    this.providers.set(provider.id.toLowerCase(), provider);
    logger.debug(`Registered AI Provider: [${provider.id}]`);
  }

  public getProvider(id: string): AIProvider | undefined {
    return this.providers.get(id.toLowerCase());
  }

  public hasProvider(id: string): boolean {
    return this.providers.has(id.toLowerCase());
  }

  public listProviders(): AIProvider[] {
    return Array.from(this.providers.values());
  }

  public unregisterProvider(id: string): boolean {
    return this.providers.delete(id.toLowerCase());
  }

  public clear(): void {
    this.providers.clear();
  }
}
