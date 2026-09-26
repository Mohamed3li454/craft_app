import { MockEmbeddingProvider } from '../src/modules/cache/embedding/mock_embedding.provider';
import { GenericHttpEmbeddingProvider } from '../src/modules/cache/embedding/generic_http_embedding.provider';
import { EmbeddingFactory } from '../src/modules/cache/embedding/embedding.factory';
import {
  EmbeddingDimensionMismatchError,
  EmbeddingTimeoutError,
  EmbeddingConfigError,
  EmbeddingNetworkError,
} from '../src/modules/cache/embedding/embedding.interface';

describe('Phase 2: EmbeddingProvider Abstraction & Pluggable Providers', () => {
  describe('MockEmbeddingProvider', () => {
    const provider = new MockEmbeddingProvider(768);

    test('embed() returns vector of exact configured dimension', async () => {
      const vec = await provider.embed('صباح الخير');
      expect(Array.isArray(vec)).toBe(true);
      expect(vec.length).toBe(768);
    });

    test('embed() is deterministic for identical inputs', async () => {
      const vec1 = await provider.embed('how do I change my password?');
      const vec2 = await provider.embed('how do I change my password?');
      expect(vec1).toEqual(vec2);
    });

    test('embedBatch() produces correct number of vectors matching inputs', async () => {
      const inputs = ['أهلاً', 'hello', 'bonjour', 'hola'];
      const batch = await provider.embedBatch(inputs);
      expect(batch.length).toBe(4);
      for (const vec of batch) {
        expect(vec.length).toBe(768);
      }
    });

    test('empty input returns zero-filled vector of exact dimension', async () => {
      const vec = await provider.embed('   ');
      expect(vec.length).toBe(768);
      expect(vec.every((v) => v === 0)).toBe(true);
    });

    test('long input handles gracefully without error', async () => {
      const longText = 'كلمة '.repeat(1000); // 5000+ chars
      const vec = await provider.embed(longText);
      expect(vec.length).toBe(768);
    });

    test('supports custom dimension configuration (e.g. 384)', async () => {
      const customProvider = new MockEmbeddingProvider(384);
      expect(customProvider.dimension).toBe(384);
      const vec = await customProvider.embed('test 384');
      expect(vec.length).toBe(384);
    });
  });

  describe('GenericHttpEmbeddingProvider (Validation & Error Handling)', () => {
    test('missing endpoint throws EmbeddingConfigError', () => {
      expect(() => {
        new GenericHttpEmbeddingProvider({
          endpoint: '',
          dimension: 768,
        });
      }).toThrow(EmbeddingConfigError);
    });

    test('invalid dimension throws EmbeddingConfigError', () => {
      expect(() => {
        new GenericHttpEmbeddingProvider({
          endpoint: 'https://example.com/embed',
          dimension: 0,
        });
      }).toThrow(EmbeddingConfigError);
    });

    test('provider unavailable throws EmbeddingNetworkError without leaking sensitive data', async () => {
      const provider = new GenericHttpEmbeddingProvider({
        endpoint: 'http://127.0.0.1:54321/non-existent-embedding',
        apiKey: 'super_secret_test_token_xyz123',
        dimension: 768,
        timeoutMs: 1000,
      });

      await expect(provider.embed('hello world')).rejects.toThrow();

      try {
        await provider.embed('hello world');
      } catch (err: any) {
        // Assert security rule: API key must NOT be leaked in error message
        expect(err.message).not.toContain('super_secret_test_token_xyz123');
      }
    });

    test('invalid HTTP status (e.g. 500) throws EmbeddingNetworkError', async () => {
      // Mock global fetch for this test
      const originalFetch = global.fetch;
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: async () => 'Service Crash',
      }) as any;

      try {
        const provider = new GenericHttpEmbeddingProvider({
          endpoint: 'https://api.example.com/v1/embeddings',
          dimension: 768,
        });

        await expect(provider.embed('test query')).rejects.toThrow(EmbeddingNetworkError);
      } finally {
        global.fetch = originalFetch;
      }
    });

    test('malformed JSON response throws EmbeddingError', async () => {
      const originalFetch = global.fetch;
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError('Unexpected token < in JSON at position 0');
        },
      }) as any;

      try {
        const provider = new GenericHttpEmbeddingProvider({
          endpoint: 'https://api.example.com/v1/embeddings',
          dimension: 768,
        });

        await expect(provider.embed('test query')).rejects.toThrow();
      } finally {
        global.fetch = originalFetch;
      }
    });

    test('dimension mismatch (e.g. received 512 vs expected 768) throws EmbeddingDimensionMismatchError', async () => {
      const originalFetch = global.fetch;
      const returnedVector512 = new Array(512).fill(0.1);

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          data: [{ embedding: returnedVector512 }],
        }),
      }) as any;

      try {
        const provider = new GenericHttpEmbeddingProvider({
          endpoint: 'https://api.example.com/v1/embeddings',
          dimension: 768, // Expects 768
        });

        await expect(provider.embed('test query')).rejects.toThrow(
          EmbeddingDimensionMismatchError
        );
      } finally {
        global.fetch = originalFetch;
      }
    });

    test('request timeout triggers EmbeddingTimeoutError', async () => {
      const originalFetch = global.fetch;
      global.fetch = jest.fn().mockImplementation((_url, options) => {
        return new Promise((_, reject) => {
          options?.signal?.addEventListener('abort', () => {
            const abortErr = new Error('The operation was aborted');
            abortErr.name = 'AbortError';
            reject(abortErr);
          });
        });
      }) as any;

      try {
        const provider = new GenericHttpEmbeddingProvider({
          endpoint: 'https://api.example.com/v1/embeddings',
          dimension: 768,
          timeoutMs: 50, // Ultra short 50ms timeout
        });

        await expect(provider.embed('timeout test')).rejects.toThrow(EmbeddingTimeoutError);
      } finally {
        global.fetch = originalFetch;
      }
    });

    test('successfully parses OpenAI-style response format when dimension matches', async () => {
      const originalFetch = global.fetch;
      const expectedVector = new Array(768).fill(0.05);

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          data: [{ embedding: expectedVector }],
        }),
      }) as any;

      try {
        const provider = new GenericHttpEmbeddingProvider({
          endpoint: 'https://api.example.com/v1/embeddings',
          dimension: 768,
        });

        const res = await provider.embed('valid query');
        expect(res).toEqual(expectedVector);
      } finally {
        global.fetch = originalFetch;
      }
    });
  });

  describe('EmbeddingFactory', () => {
    beforeEach(() => {
      EmbeddingFactory.resetSharedProvider();
    });

    test('defaults to MockEmbeddingProvider when unconfigured', () => {
      const provider = EmbeddingFactory.createProvider();
      expect(provider.name).toBe('mock');
      expect(provider.dimension).toBe(768);
    });

    test('falls back safely to MockEmbeddingProvider if generic_http endpoint is missing', () => {
      const provider = EmbeddingFactory.createProvider({
        provider: 'generic_http',
        endpoint: '',
      });
      expect(provider.name).toBe('mock');
    });

    test('returns GenericHttpEmbeddingProvider when properly configured', () => {
      const provider = EmbeddingFactory.createProvider({
        provider: 'generic_http',
        endpoint: 'https://api.example.com/embed',
        dimension: 384,
      });
      expect(provider.name).toBe('generic_http');
      expect(provider.dimension).toBe(384);
    });
  });
});
