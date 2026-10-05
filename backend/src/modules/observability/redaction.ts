const COT_PATTERNS = [
  'thought',
  'thoughts',
  'reasoning',
  'reasoning_content',
  'chain_of_thought',
  'internal_reasoning',
  'cot',
];

const SAFE_NUMERIC_TELEMETRY_KEYS = new Set([
  'tokens',
  'tokencount',
  'prompttokens',
  'completiontokens',
  'totaltokens',
  'durationms',
  'latencyms',
  'duration_ms',
  'latency_ms',
  'cost',
  'score',
  'stepscount',
  'steps_count',
]);

/**
 * Centralized Redaction Layer (Phase 8.5 & Phase 12.2 Hardening)
 *
 * Enforces strict data minimization, secret sanitization, and CoT removal across
 * structured logs, trace attributes, evaluation output, and error messages,
 * while preserving safe numeric telemetry metrics.
 */
const SENSITIVE_KEY_PATTERNS = [
  'password',
  'token',
  'api_key',
  'apikey',
  'secret',
  'authorization',
  'cookie',
  'bearer',
  'private_key',
  'access_token',
  'refresh_token',
  'verify_token',
  'app_secret',
  'otp',
  'credit_card',
  'ssn',
];

/**
 * Sanitizes raw string content, masking credentials, tokens, connection strings, and PII.
 */
export function redactSecrets(input: string): string {
  if (!input || typeof input !== 'string') return '';

  return input
    // Bearer & Authorization headers
    .replace(/authorization\s*:\s*bearer\s+[^\s'",;]+/gi, 'Authorization: Bearer [REDACTED_TOKEN]')
    .replace(/bearer\s+[a-zA-Z0-9_\-\.=:_+/]+/gi, 'Bearer [REDACTED_TOKEN]')
    .replace(/(authorization\s*:\s*(?!bearer)['"]?)[^\s'"]+(['"]?)/gi, '$1[REDACTED_TOKEN]$2')

    // Vendor API Keys (Groq, Supabase, Meta, Generic)
    .replace(/gsk_[a-zA-Z0-9_]{8,}/gi, '[REDACTED_API_KEY]')
    .replace(/sbp_[a-zA-Z0-9_]{8,}/gi, '[REDACTED_API_KEY]')
    .replace(/EAA[a-zA-Z0-9_\-]{16,}/gi, '[REDACTED_TOKEN]')
    .replace(/(api[_-]?key\s*[:=]\s*['"]?)[a-zA-Z0-9_\-\.]+(['"]?)/gi, '$1[REDACTED_API_KEY]$2')

    // Database Connection Strings
    .replace(/postgres(?:ql)?:\/\/[^:]+:[^@]+@[^/]+\/[^\s'"?]+/gi, 'postgres://[REDACTED_USER]:[REDACTED_PASSWORD]@[REDACTED_HOST]/[REDACTED_DB]')
    .replace(/mysql:\/\/[^:]+:[^@]+@[^/]+\/[^\s'"?]+/gi, 'mysql://[REDACTED_USER]:[REDACTED_PASSWORD]@[REDACTED_HOST]/[REDACTED_DB]')

    // Passwords & Secrets
    .replace(/(password\s*[:=]\s*['"]?)[^\s'",;]+(['"]?)/gi, '$1[REDACTED_PASSWORD]$2')
    .replace(/(secret\s*[:=]\s*['"]?)[a-zA-Z0-9_\-\.]+(['"]?)/gi, '$1[REDACTED_SECRET]$2')
    .replace(/(verify[_-]?token\s*[:=]\s*['"]?)[a-zA-Z0-9_\-\.]+(['"]?)/gi, '$1[REDACTED_TOKEN]$2')

    // OTPs (6 digit pins in auth context)
    .replace(/(\b(?:otp|code|pin)\s*[:=]\s*['"]?)\d{4,8}(['"]?)/gi, '$1[REDACTED_OTP]$2')

    // Email Addresses
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/gi, '[REDACTED_EMAIL]');
}

/**
 * Recursively redacts sensitive keys and values from objects, arrays, and primitives.
 */
export function redactObject<T = unknown>(input: T, depth = 0): T {
  if (depth > 8 || input === null || input === undefined) {
    return input;
  }

  if (typeof input === 'string') {
    return redactSecrets(input) as unknown as T;
  }

  if (Array.isArray(input)) {
    return input.map((item) => redactObject(item, depth + 1)) as unknown as T;
  }

  if (typeof input === 'object' && input !== null) {
    // Handle standard Error instances
    if (input instanceof Error) {
      const sanitizedErr: Record<string, unknown> = {
        name: input.name,
        message: redactSecrets(input.message),
      };
      if (input.stack) {
        sanitizedErr.stack = redactSecrets(input.stack);
      }
      for (const [key, value] of Object.entries(input)) {
        sanitizedErr[key] = redactObject(value, depth + 1);
      }
      return sanitizedErr as unknown as T;
    }

    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      const lowerKey = key.toLowerCase();

      // 1. Safe numeric telemetry keys must be preserved as numeric values
      const isNumericTelemetry =
        typeof value === 'number' &&
        (SAFE_NUMERIC_TELEMETRY_KEYS.has(lowerKey) ||
          lowerKey.endsWith('tokens') ||
          lowerKey.endsWith('token') ||
          lowerKey.endsWith('tokencount') ||
          lowerKey.endsWith('ms'));

      if (isNumericTelemetry) {
        sanitized[key] = value;
        continue;
      }

      // 2. Strip / redact Chain of Thought and internal reasoning
      const isCot = COT_PATTERNS.some((pattern) => lowerKey === pattern || lowerKey.includes(pattern));
      if (isCot) {
        sanitized[key] = '[REDACTED_REASONING]';
        continue;
      }

      // 3. Redact credentials and sensitive keys
      const isSensitiveKey = SENSITIVE_KEY_PATTERNS.some((pattern) => lowerKey.includes(pattern));

      if (isSensitiveKey) {
        if (typeof value === 'string') {
          sanitized[key] = '[REDACTED]';
        } else if (typeof value === 'number' || typeof value === 'boolean') {
          sanitized[key] = '[REDACTED]';
        } else if (typeof value === 'object' && value !== null) {
          sanitized[key] = '[REDACTED_OBJECT]';
        } else {
          sanitized[key] = '[REDACTED]';
        }
      } else {
        sanitized[key] = redactObject(value, depth + 1);
      }
    }
    return sanitized as unknown as T;
  }

  return input;
}
