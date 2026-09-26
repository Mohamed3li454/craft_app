import { EmbeddingProvider } from './embedding.interface';
import { MockEmbeddingProvider } from './mock_embedding.provider';
import { GenericHttpEmbeddingProvider } from './generic_http_embedding.provider';
import { config } from '../../../config/env';
import { logger } from '../../../core/logger';

export interface EmbeddingFactoryOptions {
  provider?: string;
  endpoint?: string;
  apiKey?: string;
  model?: string;
  dimension?: number;
  timeoutMs?: number;
}

export class EmbeddingFactory {
  private static cachedProvider: EmbeddingProvider | null = null;

  /**
   * Creates an EmbeddingProvider instance based on explicit options or process.env configuration.
   * If unconfigured or in test mode, safely defaults to MockEmbeddingProvider.
   */
  public static createProvider(options?: EmbeddingFactoryOptions): EmbeddingProvider {
    const providerType = (
      options?.provider ||
      process.env.EMBEDDING_PROVIDER ||
      (config as any).embedding?.provider ||
      'mock'
    ).toLowerCase().trim();

    const dimension =
      options?.dimension ||
      parseInt(process.env.EMBEDDING_DIMENSION || '', 10) ||
      (config as any).embedding?.dimension ||
      768;

    const timeoutMs =
      options?.timeoutMs ||
      parseInt(process.env.EMBEDDING_TIMEOUT_MS || '', 10) ||
      (config as any).embedding?.timeoutMs ||
      3000;

    if (providerType === 'generic_http') {
      const endpoint =
        options?.endpoint ||
        process.env.EMBEDDING_ENDPOINT ||
        (config as any).embedding?.endpoint;

      const apiKey =
        options?.apiKey ||
        process.env.EMBEDDING_API_KEY ||
        (config as any).embedding?.apiKey;

      const model =
        options?.model ||
        process.env.EMBEDDING_MODEL ||
        (config as any).embedding?.model;

      if (!endpoint) {
        logger.warn(
          'EMBEDDING_PROVIDER is set to generic_http but EMBEDDING_ENDPOINT is missing. Falling back safely to MockEmbeddingProvider.'
        );
        return new MockEmbeddingProvider(dimension);
      }

      return new GenericHttpEmbeddingProvider({
        endpoint,
        apiKey,
        model,
        dimension,
        timeoutMs,
      });
    }

    // Default: MockEmbeddingProvider
    return new MockEmbeddingProvider(dimension);
  }

  /**
   * Singleton accessor for application-wide shared embedding provider.
   */
  public static getSharedProvider(): EmbeddingProvider {
    if (!EmbeddingFactory.cachedProvider) {
      EmbeddingFactory.cachedProvider = EmbeddingFactory.createProvider();
    }
    return EmbeddingFactory.cachedProvider;
  }

  /**
   * Resets cached instance (useful in tests).
   */
  public static resetSharedProvider(): void {
    EmbeddingFactory.cachedProvider = null;
  }
}
