/**
 * Trace & AI Observatory Safety Sanitizer
 *
 * Enforces strict operational redaction of:
 * - Credentials, API keys, tokens, cookies, passwords, connection strings
 * - Internal reasoning, thoughts, Chain-of-Thought (CoT), scratchpads, system prompts
 *
 * Strictly preserves legitimate telemetry:
 * - tokenCount, totalTokens, promptTokens, completionTokens, tokenUsage
 * - durationMs, latencyMs, status, toolName, model, provider, timestamps
 */

const SAFE_TELEMETRY_KEYS = new Set([
  'tokencount',
  'totaltokens',
  'tokensused',
  'tokenusage',
  'prompttokens',
  'completiontokens',
  'maxtokens',
  'inputtokens',
  'outputtokens',
  'durationms',
  'latencyms',
  'status',
  'toolname',
  'model',
  'provider',
  'createdat',
  'completedat',
  'iterationscount',
  'toolcallscount',
  'query',
  'limit',
  'page',
  'offset',
  'step',
  'iteration',
  'schedule',
  'expression',
  'code',
  'message',
]);

/**
 * Checks whether a key represents legitimate telemetry that must be preserved.
 */
export function isTelemetryKey(key: string): boolean {
  if (!key || typeof key !== 'string') return false;
  const norm = key.toLowerCase().replace(/[-_\s.]/g, '');

  if (SAFE_TELEMETRY_KEYS.has(norm)) {
    return true;
  }

  if (
    norm.endsWith('tokens') &&
    (norm.startsWith('prompt') ||
      norm.startsWith('completion') ||
      norm.startsWith('total') ||
      norm.startsWith('max') ||
      norm.startsWith('input') ||
      norm.startsWith('output'))
  ) {
    return true;
  }

  if (norm.endsWith('tokenscount') || norm.endsWith('tokenusage')) {
    return true;
  }

  return false;
}

/**
 * Determines whether an object key is sensitive (credentials or internal reasoning).
 */
export function isSensitiveKey(key: string, value?: unknown): boolean {
  if (!key || typeof key !== 'string') return false;
  const norm = key.toLowerCase().replace(/[-_\s.]/g, '');

  // 1. Never flag legitimate telemetry
  if (isTelemetryKey(key)) {
    return false;
  }

  // 2. Ambiguous "token" or "tokens" key
  if (norm === 'token' || norm === 'tokens') {
    // If value is a number, it represents token metrics / counts
    if (typeof value === 'number') {
      return false;
    }
    // If value is string, object, or undefined, treat as auth credential
    return true;
  }

  // 3. Known credential keys
  const SENSITIVE_EXACT_KEYS = new Set([
    'apikey',
    'secret',
    'password',
    'passwd',
    'credential',
    'credentials',
    'privatekey',
    'authorization',
    'cookie',
    'cookies',
    'sessiontoken',
    'csrftoken',
    'webhooksecret',
    'signingsecret',
    'databaseurl',
    'dbpassword',
    'dbpass',
    'clientsecret',
    'appsecret',
    'authtoken',
    'accesstoken',
    'refreshtoken',
    'bearer',
    'bearertoken',
    'idtoken',
    'jwttoken',
    'apisecret',
  ]);

  if (SENSITIVE_EXACT_KEYS.has(norm)) {
    return true;
  }

  // Suffix / Substring patterns for secrets
  if (
    norm.includes('secret') ||
    norm.includes('password') ||
    norm.includes('passwd') ||
    norm.includes('privatekey') ||
    norm.includes('apikey') ||
    norm.endsWith('token') ||
    norm.endsWith('tokens')
  ) {
    return true;
  }

  // 4. Internal Reasoning & Prompts (CoT, scratchpads, system prompts)
  if (
    norm === 'reasoning' ||
    norm.endsWith('reasoning') ||
    norm === 'thought' ||
    norm === 'thoughts' ||
    norm.endsWith('thought') ||
    norm.endsWith('thoughts') ||
    norm.includes('chainofthought') ||
    norm.includes('scratchpad') ||
    norm.includes('hiddenreasoning') ||
    norm.includes('internalreasoning') ||
    norm.includes('systemprompt') ||
    norm.includes('prompttemplate')
  ) {
    // Allow UI boolean flag "hasRedactedReasoning"
    if (norm === 'hasredactedreasoning' && typeof value === 'boolean') {
      return false;
    }
    return true;
  }

  return false;
}

/**
 * Sanitizes plain string values to prevent leakage of credentials,
 * connection strings, Bearer tokens, or API keys embedded in text or logs.
 */
export function sanitizeSafeString(str: string): string {
  if (!str || typeof str !== 'string') return str;

  let sanitized = str;

  // 1. Connection strings / Database URLs: protocol://user:pass@host
  sanitized = sanitized.replace(
    /([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)([^:@\s]+):([^@\s]+)@/g,
    '$1$2:[REDACTED]@'
  );

  // 2. Sensitive query parameters in URLs: ?api_key=SECRET or &token=SECRET
  sanitized = sanitized.replace(
    /([?&](?:api[_-]?key|apikey|token|access[_-]?token|auth[_-]?token|secret[_-]?key|secret|password|client[_-]?secret)=)([^&\s"'`]+)/gi,
    '$1[REDACTED]'
  );

  // 3. Authorization / Bearer / Basic / Token headers
  sanitized = sanitized.replace(
    /\b(bearer|basic)\s+[a-z0-9._~+/-]+=*/gi,
    '$1 [REDACTED]'
  );
  sanitized = sanitized.replace(
    /\b(token)\s+(?!bearer\b)[a-z0-9._~+/-]+=*/gi,
    '$1 [REDACTED]'
  );

  // 4. Known API key signatures (OpenAI, Groq, GitHub, etc.)
  sanitized = sanitized.replace(
    /\b(?:sk-[a-zA-Z0-9_-]{16,}|gsk_[a-zA-Z0-9_-]{16,}|ghp_[a-zA-Z0-9_-]{20,}|sk_live_[a-zA-Z0-9_-]{16,}|sk_test_[a-zA-Z0-9_-]{16,})\b/g,
    '[REDACTED]'
  );

  // 5. JWT tokens
  sanitized = sanitized.replace(
    /\beyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\b/g,
    '[REDACTED]'
  );

  // 6. Private keys
  sanitized = sanitized.replace(
    /-----BEGIN [A-Z ]+PRIVATE KEY-----[\s\S]*?-----END [A-Z ]+PRIVATE KEY-----/g,
    '[REDACTED PRIVATE KEY]'
  );

  // 7. Key-value assignment in errors/logs (e.g. api_key="secret", password: "xyz")
  sanitized = sanitized.replace(
    /(?:^|[^\w?&])(api[_-]?key|access[_-]?token|auth[_-]?token|refresh[_-]?token|secret[_-]?key|secret|password|credential|database[_-]?url)\b\s*([:=])\s*(['"]?)([^'"\s,;&]+)\3/gi,
    (match, key, sep, quote, val) => {
      if (val === '[REDACTED]') return match;
      const keyIdx = match.indexOf(key);
      const prefix = match.slice(0, keyIdx);
      return `${prefix}${key}${sep} ${quote}[REDACTED]${quote}`;
    }
  );

  return sanitized;
}

/**
 * Deep recursive defensive sanitizer.
 * Produces a sanitized clone of the data without mutating input.
 * Replaces sensitive keys and credential values with '[REDACTED]'.
 */
export function sanitizeSafeMetadata<T = any>(data: T): T {
  if (data === null || data === undefined) return data;

  if (typeof data === 'string') {
    return sanitizeSafeString(data) as unknown as T;
  }

  if (typeof data !== 'object') {
    return data;
  }

  if (Array.isArray(data)) {
    return data.map((item) => sanitizeSafeMetadata(item)) as unknown as T;
  }

  const clean: Record<string, any> = {};
  for (const [k, v] of Object.entries(data)) {
    if (isSensitiveKey(k, v)) {
      clean[k] = '[REDACTED]';
    } else if (typeof v === 'object' && v !== null) {
      clean[k] = sanitizeSafeMetadata(v);
    } else if (typeof v === 'string') {
      clean[k] = sanitizeSafeString(v);
    } else {
      clean[k] = v;
    }
  }

  return clean as T;
}

/**
 * Safe JSON stringify that always sanitizes before stringifying.
 */
export function safeJsonStringify(data: any, space = 2): string {
  try {
    const clean = sanitizeSafeMetadata(data);
    return JSON.stringify(clean, null, space);
  } catch {
    return String(data);
  }
}

/**
 * Sanitizes errorDetails and error messages.
 * Formats JSON error payloads safely, and redacts plain-text stack traces / error strings.
 */
export function sanitizeSafeErrorDetails(errorDetails: unknown): string {
  if (errorDetails === null || errorDetails === undefined) {
    return '';
  }

  if (typeof errorDetails === 'object') {
    const cleanObj = sanitizeSafeMetadata(errorDetails);
    return safeJsonStringify(cleanObj);
  }

  const str = String(errorDetails).trim();
  if (!str) return '';

  if ((str.startsWith('{') && str.endsWith('}')) || (str.startsWith('[') && str.endsWith(']'))) {
    try {
      const parsed = JSON.parse(str);
      const cleanParsed = sanitizeSafeMetadata(parsed);
      return safeJsonStringify(cleanParsed);
    } catch {
      // Not valid JSON, fallback to string sanitization
    }
  }

  return sanitizeSafeString(str);
}
