import {
  isTelemetryKey,
  isSensitiveKey,
  sanitizeSafeString,
  sanitizeSafeMetadata,
  sanitizeSafeErrorDetails,
  safeJsonStringify,
} from '../src/lib/safety/trace-sanitizer';

describe('Phase 11.5 Security Hardening — Trace Safety Sanitizer', () => {
  describe('1. Chain-of-Thought (CoT) & Reasoning Defense', () => {
    it('redacts root-level reasoning, thoughts, scratchpad, and system prompts', () => {
      const unsafePayload = {
        reasoning: 'private reasoning turn 1',
        thoughts: ['internal thought A', 'internal thought B'],
        scratchpad: 'secret scratchpad memory buffer',
        system_prompt: 'private system prompt instructions',
        normal: 'safe',
      };

      const result = sanitizeSafeMetadata(unsafePayload);

      expect(result.reasoning).toBe('[REDACTED]');
      expect(result.thoughts).toBe('[REDACTED]');
      expect(result.scratchpad).toBe('[REDACTED]');
      expect(result.system_prompt).toBe('[REDACTED]');
      expect(result.normal).toBe('safe');
      // Original payload must not be mutated
      expect(unsafePayload.reasoning).toBe('private reasoning turn 1');
    });

    it('redacts deeply nested reasoning structures', () => {
      const nestedPayload = {
        metadata: {
          execution: {
            reasoning: 'secret',
            hidden_reasoning: 'internal reasoning trace',
            chain_of_thought: 'deliberate multi-step plan',
            prompt_template: 'System instructions: you are an agent',
            step_id: 'step-01',
          },
        },
      };

      const result = sanitizeSafeMetadata(nestedPayload);

      expect(result.metadata.execution.reasoning).toBe('[REDACTED]');
      expect(result.metadata.execution.hidden_reasoning).toBe('[REDACTED]');
      expect(result.metadata.execution.chain_of_thought).toBe('[REDACTED]');
      expect(result.metadata.execution.prompt_template).toBe('[REDACTED]');
      expect(result.metadata.execution.step_id).toBe('step-01');
    });

    it('redacts reasoning and thoughts inside arrays of execution events', () => {
      const arrayPayload = {
        events: [
          { type: 'start', timestamp: 100 },
          { thought: 'secret internal thought', confidence: 0.95 },
          { action: 'tool_call', reasoning: 'selected calculator because math needed' },
        ],
      };

      const result = sanitizeSafeMetadata(arrayPayload);

      expect(result.events[0]).toEqual({ type: 'start', timestamp: 100 });
      expect(result.events[1].thought).toBe('[REDACTED]');
      expect(result.events[1].confidence).toBe(0.95);
      expect(result.events[2].reasoning).toBe('[REDACTED]');
      expect(result.events[2].action).toBe('tool_call');
    });
  });

  describe('2. Credential & Secret Defense', () => {
    it('redacts all casing and delimiter variants of API keys and tokens', () => {
      const credentialsPayload = {
        apiKey: 'key_1',
        API_KEY: 'key_2',
        api_key: 'key_3',
        'Api-Key': 'key_4',
        accessToken: 'tok_access_1',
        access_token: 'tok_access_2',
        authorization: 'Bearer secret_auth_bearer',
        cookie: 'session_cookie_secret',
        password: 'super_secret_db_password',
        databaseUrl: 'postgres://user:pass@host/db',
        database_url: 'postgres://user:pass@host/db',
        webhookSecret: 'whsec_999999',
        signing_secret: 'sign_sec_8888',
        safeField: 'legitimate_value',
      };

      const result = sanitizeSafeMetadata(credentialsPayload);

      expect(result.apiKey).toBe('[REDACTED]');
      expect(result.API_KEY).toBe('[REDACTED]');
      expect(result.api_key).toBe('[REDACTED]');
      expect(result['Api-Key']).toBe('[REDACTED]');
      expect(result.accessToken).toBe('[REDACTED]');
      expect(result.access_token).toBe('[REDACTED]');
      expect(result.authorization).toBe('[REDACTED]');
      expect(result.cookie).toBe('[REDACTED]');
      expect(result.password).toBe('[REDACTED]');
      expect(result.databaseUrl).toBe('[REDACTED]');
      expect(result.database_url).toBe('[REDACTED]');
      expect(result.webhookSecret).toBe('[REDACTED]');
      expect(result.signing_secret).toBe('[REDACTED]');
      expect(result.safeField).toBe('legitimate_value');
    });

    it('redacts credentials in nested objects and arrays', () => {
      const nested = {
        config: {
          client: {
            client_secret: 'sec_123',
            client_id: 'app_pub_1',
          },
        },
        headers: [
          { name: 'Authorization', value: 'Bearer token123' },
          { name: 'X-Custom-Header', value: 'public-data' },
        ],
      };

      const result = sanitizeSafeMetadata(nested);

      expect(result.config.client.client_secret).toBe('[REDACTED]');
      expect(result.config.client.client_id).toBe('app_pub_1');
      expect(result.headers[0].value).toBe('Bearer [REDACTED]');
      expect(result.headers[1].value).toBe('public-data');
    });
  });

  describe('3. Telemetry Preservation (No Over-Redaction)', () => {
    it('preserves all legitimate operational telemetry metrics without redaction', () => {
      const legitimateTelemetry = {
        model: 'openai/gpt-oss-120b',
        provider: 'Groq',
        tokenCount: 6669,
        totalTokens: 6669,
        promptTokens: 5000,
        completionTokens: 1669,
        latencyMs: 3450,
        durationMs: 3500,
        toolCallsCount: 2,
        status: 'completed',
        tokensUsed: 6669,
        tokenUsage: {
          promptTokens: 5000,
          completionTokens: 1669,
          totalTokens: 6669,
        },
      };

      const result = sanitizeSafeMetadata(legitimateTelemetry);

      expect(result).toEqual(legitimateTelemetry);
    });

    it('disambiguates token counts from auth tokens', () => {
      // Numeric token count is legitimate telemetry
      expect(isSensitiveKey('tokens', 1500)).toBe(false);
      expect(isSensitiveKey('token', 2048)).toBe(false);
      expect(isTelemetryKey('tokenCount')).toBe(true);
      expect(isTelemetryKey('promptTokens')).toBe(true);
      expect(isTelemetryKey('completionTokens')).toBe(true);

      // String token is considered auth credential
      expect(isSensitiveKey('token', 'eyJhbGciOiJIUzI1Ni...')).toBe(true);
      expect(isSensitiveKey('accessToken')).toBe(true);
      expect(isSensitiveKey('refreshToken')).toBe(true);
      expect(isSensitiveKey('sessionToken')).toBe(true);
    });
  });

  describe('4. Error Details & URL Sanitization', () => {
    it('sanitizes structured error objects while preserving diagnostic information', () => {
      const errorPayload = {
        code: 'PROVIDER_ERROR',
        message: 'Provider request failed',
        authorization: 'Bearer SECRET',
        details: {
          api_key: 'SECRET',
          provider: 'Groq',
        },
      };

      const result = JSON.parse(sanitizeSafeErrorDetails(errorPayload));

      expect(result.code).toBe('PROVIDER_ERROR');
      expect(result.message).toBe('Provider request failed');
      expect(result.authorization).toBe('[REDACTED]');
      expect(result.details.api_key).toBe('[REDACTED]');
      expect(result.details.provider).toBe('Groq');
    });

    it('sanitizes database connection URLs in string error messages', () => {
      const rawError = 'Failed to connect to postgres://app_admin:super_secret_db_pass_99@db-cluster.internal:5432/craft_prod';
      const sanitized = sanitizeSafeErrorDetails(rawError);

      expect(sanitized).toBe('Failed to connect to postgres://app_admin:[REDACTED]@db-cluster.internal:5432/craft_prod');
      expect(sanitized).not.toContain('super_secret_db_pass_99');
    });

    it('sanitizes sensitive query parameters in URL error messages', () => {
      const rawUrl = 'Upstream gateway timeout at https://api.groq.com/openai/v1/chat?api_key=gsk_secret1234567890abcdef12345&limit=10';
      const sanitized = sanitizeSafeString(rawUrl);

      expect(sanitized).toContain('api_key=[REDACTED]');
      expect(sanitized).toContain('&limit=10');
      expect(sanitized).not.toContain('gsk_secret1234567890abcdef12345');
    });

    it('sanitizes Bearer tokens in plain text error logs', () => {
      const log = 'Upstream 401 Unauthorized: Authorization Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyIjoxfQ.signature_secret';
      const sanitized = sanitizeSafeString(log);

      expect(sanitized).toBe('Upstream 401 Unauthorized: Authorization Bearer [REDACTED]');
      expect(sanitized).not.toContain('signature_secret');
    });
  });

  describe('5. safeJsonStringify defense-in-depth', () => {
    it('automatically sanitizes raw objects before stringifying', () => {
      const rawObj = {
        status: 'running',
        secret_key: 'confidential_123',
        reasoning: 'should choose tool',
      };

      const jsonStr = safeJsonStringify(rawObj);

      expect(jsonStr).toContain('"status": "running"');
      expect(jsonStr).toContain('"secret_key": "[REDACTED]"');
      expect(jsonStr).toContain('"reasoning": "[REDACTED]"');
      expect(jsonStr).not.toContain('confidential_123');
      expect(jsonStr).not.toContain('should choose tool');
    });
  });
});
