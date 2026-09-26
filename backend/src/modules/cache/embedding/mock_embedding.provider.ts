import crypto from 'crypto';
import {
  EmbeddingProvider,
  EmbeddingDimensionMismatchError,
} from './embedding.interface';

/**
 * Deterministic Mock Embedding Provider for local development, CI and unit testing.
 * 
 * Generates unit-normalized pseudo-vectors based on SHA-256 seed expansion.
 * Ensures that identical inputs yield identical vectors, and outputs strictly match this.dimension.
 */
export class MockEmbeddingProvider implements EmbeddingProvider {
  public readonly name = 'mock';

  constructor(public readonly dimension: number = 768) {
    if (dimension <= 0) {
      throw new Error(`Invalid MockEmbeddingProvider dimension: ${dimension}`);
    }
  }

  public async embed(text: string): Promise<number[]> {
    const vector = this.generateDeterministicVector(text);
    if (vector.length !== this.dimension) {
      throw new EmbeddingDimensionMismatchError(this.dimension, vector.length);
    }
    return vector;
  }

  public async embedBatch(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map((t) => this.embed(t)));
  }

  /**
   * Generates a deterministic unit vector for a given text string.
   */
  private generateDeterministicVector(text: string): number[] {
    const raw = (text || '').trim();
    if (!raw) {
      // Return zero-filled vector for empty string
      return new Array(this.dimension).fill(0);
    }

    // Hash the input string using SHA-256
    const hash = crypto.createHash('sha256').update(raw, 'utf8').digest();
    const vector: number[] = new Array(this.dimension);

    // Seed-expand hash bytes into full float vector
    for (let i = 0; i < this.dimension; i++) {
      const byte1 = hash[i % hash.length];
      const byte2 = hash[(i * 7 + 13) % hash.length];
      const val = ((byte1 << 8) | byte2) / 65535.0; // [0, 1]
      vector[i] = (val - 0.5) * 2.0; // [-1, 1]
    }

    // Normalize to unit vector (L2 norm = 1.0)
    let sumSq = 0;
    for (let i = 0; i < this.dimension; i++) {
      sumSq += vector[i] * vector[i];
    }
    const norm = Math.sqrt(sumSq) || 1.0;
    for (let i = 0; i < this.dimension; i++) {
      vector[i] = Number((vector[i] / norm).toFixed(6));
    }

    return vector;
  }
}
