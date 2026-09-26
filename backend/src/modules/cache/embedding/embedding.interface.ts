/**
 * Core Provider-Agnostic Embedding Interfaces and Errors.
 * 
 * Completely decoupled from any LLM/AI Provider in the system.
 */

export interface EmbeddingProvider {
  /**
   * The fixed vector dimensionality expected from this provider (e.g. 768, 384, 1536).
   * Used for strict database schema compatibility checks before vector ingestion.
   */
  readonly dimension: number;

  /**
   * The human-readable name or identifier of the provider implementation.
   */
  readonly name: string;

  /**
   * Generates an embedding vector for a single input text.
   * Throws EmbeddingDimensionMismatchError if the returned vector does not match this.dimension.
   */
  embed(text: string): Promise<number[]>;

  /**
   * Generates embedding vectors in batch for multiple input texts.
   */
  embedBatch(texts: string[]): Promise<number[][]>;
}

export class EmbeddingError extends Error {
  constructor(message: string, public readonly cause?: any) {
    super(message);
    this.name = 'EmbeddingError';
  }
}

export class EmbeddingDimensionMismatchError extends EmbeddingError {
  constructor(expected: number, actual: number) {
    super(`Embedding vector dimension mismatch: expected ${expected}, got ${actual}`);
    this.name = 'EmbeddingDimensionMismatchError';
  }
}

export class EmbeddingTimeoutError extends EmbeddingError {
  constructor(timeoutMs: number) {
    super(`Embedding request timed out after ${timeoutMs}ms`);
    this.name = 'EmbeddingTimeoutError';
  }
}

export class EmbeddingConfigError extends EmbeddingError {
  constructor(message: string) {
    super(`Embedding configuration error: ${message}`);
    this.name = 'EmbeddingConfigError';
  }
}

export class EmbeddingNetworkError extends EmbeddingError {
  constructor(message: string, public readonly statusCode?: number) {
    super(message);
    this.name = 'EmbeddingNetworkError';
  }
}
