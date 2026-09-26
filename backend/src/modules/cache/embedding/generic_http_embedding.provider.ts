import {
  EmbeddingProvider,
  EmbeddingConfigError,
  EmbeddingDimensionMismatchError,
  EmbeddingNetworkError,
  EmbeddingTimeoutError,
  EmbeddingError,
} from './embedding.interface';
import { logger } from '../../../core/logger';

export interface GenericHttpEmbeddingConfig {
  endpoint: string;
  apiKey?: string;
  model?: string;
  dimension: number;
  timeoutMs?: number;
  headers?: Record<string, string>;
}

/**
 * Generic HTTP Embedding Provider.
 * 
 * Interacts with any external embedding service (e.g. HuggingFace TEI, OpenAI-compatible, custom microservice)
 * over HTTP with strict timeout enforcement, dimension validation, and sanitized logging.
 */
export class GenericHttpEmbeddingProvider implements EmbeddingProvider {
  public readonly name = 'generic_http';
  public readonly dimension: number;
  private readonly endpoint: string;
  private readonly apiKey?: string;
  private readonly model?: string;
  private readonly timeoutMs: number;
  private readonly customHeaders: Record<string, string>;

  constructor(cfg: GenericHttpEmbeddingConfig) {
    if (!cfg.endpoint || !cfg.endpoint.trim()) {
      throw new EmbeddingConfigError('EMBEDDING_ENDPOINT is required for GenericHttpEmbeddingProvider');
    }
    if (!cfg.dimension || cfg.dimension <= 0) {
      throw new EmbeddingConfigError('EMBEDDING_DIMENSION must be a positive integer');
    }

    this.endpoint = cfg.endpoint.trim();
    this.apiKey = cfg.apiKey ? cfg.apiKey.trim() : undefined;
    this.model = cfg.model ? cfg.model.trim() : undefined;
    this.dimension = cfg.dimension;
    this.timeoutMs = cfg.timeoutMs || 3000;
    this.customHeaders = cfg.headers || {};
  }

  public static readonly MAX_INPUT_CHARS = 8192;

  public async embed(text: string): Promise<number[]> {
    const raw = (text || '').trim();
    if (!raw) {
      return new Array(this.dimension).fill(0);
    }

    const bounded = raw.length > GenericHttpEmbeddingProvider.MAX_INPUT_CHARS
      ? raw.slice(0, GenericHttpEmbeddingProvider.MAX_INPUT_CHARS)
      : raw;

    const vectors = await this.executeRequest([bounded]);
    if (!vectors || vectors.length === 0) {
      throw new EmbeddingError('Embedding provider returned empty response array');
    }

    const vector = vectors[0];
    this.validateVector(vector);

    return vector;
  }

  public async embedBatch(texts: string[]): Promise<number[][]> {
    if (!texts || texts.length === 0) {
      return [];
    }

    const cleanTexts = texts.map((t) => {
      const clean = (t || '').trim();
      return clean.length > GenericHttpEmbeddingProvider.MAX_INPUT_CHARS
        ? clean.slice(0, GenericHttpEmbeddingProvider.MAX_INPUT_CHARS)
        : clean;
    });
    const vectors = await this.executeRequest(cleanTexts);

    if (vectors.length !== texts.length) {
      throw new EmbeddingError(
        `Batch embedding size mismatch: expected ${texts.length} vectors, got ${vectors.length}`
      );
    }

    for (let i = 0; i < vectors.length; i++) {
      this.validateVector(vectors[i], i);
    }

    return vectors;
  }

  /**
   * Strictly validates vector structure, dimensions, and finite numeric values.
   * Prevents NaN, Infinity, or corrupted data from reaching PostgreSQL pgvector or cosine similarity.
   */
  private validateVector(vector: number[], index?: number): void {
    if (!Array.isArray(vector)) {
      throw new EmbeddingError(
        `Expected vector array${index !== undefined ? ` at index ${index}` : ''}, got ${typeof vector}`
      );
    }
    if (vector.length !== this.dimension) {
      throw new EmbeddingDimensionMismatchError(this.dimension, vector.length);
    }
    for (let i = 0; i < vector.length; i++) {
      if (typeof vector[i] !== 'number' || !Number.isFinite(vector[i])) {
        throw new EmbeddingError(
          `Invalid embedding vector${index !== undefined ? ` at index ${index}` : ''}: non-finite or NaN value at dimension index ${i}`
        );
      }
    }
  }

  private async executeRequest(inputs: string[]): Promise<number[][]> {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), this.timeoutMs);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...this.customHeaders,
    };

    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    // Build standard payload compatible with OpenAI, HuggingFace TEI, and Ollama
    const payload: Record<string, any> = {
      input: inputs.length === 1 ? inputs[0] : inputs,
      inputs: inputs.length === 1 ? inputs[0] : inputs,
    };
    if (this.model) {
      payload.model = this.model;
    }

    try {
      const res = await fetch(this.endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!res.ok) {
        let errSnippet = '';
        try {
          const errBody = await res.text();
          errSnippet = errBody
            .slice(0, 150)
            .replace(/Bearer\s+[a-zA-Z0-9_\-\.]+/gi, 'Bearer ***');
        } catch {
          // ignore error body parse failure
        }
        logger.error('Embedding HTTP request failed', {
          status: res.status,
          statusText: res.statusText,
          endpoint: this.maskUrl(this.endpoint),
          errorSnippet: errSnippet,
        });
        throw new EmbeddingNetworkError(
          `Embedding HTTP request failed with status ${res.status}: ${res.statusText}`,
          res.status
        );
      }

      let data: any;
      try {
        data = await res.json();
      } catch (parseErr: any) {
        throw new EmbeddingError(`Malformed JSON received from embedding provider: ${parseErr.message}`);
      }

      return this.parseVectorsFromResponse(data, inputs.length);
    } catch (err: any) {
      if (err.name === 'AbortError' || err.name === 'EmbeddingTimeoutError') {
        logger.warn('Embedding request timed out', {
          timeoutMs: this.timeoutMs,
          batchSize: inputs.length,
        });
        throw new EmbeddingTimeoutError(this.timeoutMs);
      }
      if (err instanceof EmbeddingError) {
        throw err;
      }
      logger.error('Embedding provider network error', {
        errorName: err.name,
        endpoint: this.maskUrl(this.endpoint),
      });
      throw new EmbeddingNetworkError(`Embedding request failed: ${err.message}`);
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  /**
   * Intelligently parses vector arrays from various common embedding response formats:
   * 1. OpenAI: { data: [{ embedding: [..] }] }
   * 2. HuggingFace TEI: [[...], [...]] or [...]
   * 3. Generic: { embeddings: [[...]] } or { embedding: [...] }
   */
  private parseVectorsFromResponse(data: any, expectedCount: number): number[][] {
    if (!data) {
      throw new EmbeddingError('Null response data from embedding service');
    }

    // Format 1: OpenAI { data: [{ embedding: [...] }] }
    if (data.data && Array.isArray(data.data)) {
      const result: number[][] = [];
      for (const item of data.data) {
        if (item && Array.isArray(item.embedding)) {
          result.push(item.embedding);
        }
      }
      if (result.length > 0) return result;
    }

    // Format 2: Direct array of vectors [[...], [...]]
    if (Array.isArray(data) && data.length > 0 && Array.isArray(data[0])) {
      return data;
    }

    // Format 3: Single direct vector [...] for single input
    if (Array.isArray(data) && data.length > 0 && typeof data[0] === 'number') {
      return [data];
    }

    // Format 4: Generic object with embeddings property
    if (data.embeddings && Array.isArray(data.embeddings)) {
      return data.embeddings;
    }

    if (data.embedding && Array.isArray(data.embedding)) {
      return [data.embedding];
    }

    throw new EmbeddingError('Unsupported embedding response payload structure');
  }

  private maskUrl(url: string): string {
    try {
      const parsed = new URL(url);
      return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
    } catch {
      return url.split('?')[0];
    }
  }
}
