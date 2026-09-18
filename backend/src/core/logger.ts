export enum LogLevel {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR',
}

const SENSITIVE_KEYS = [
  'password',
  'token',
  'api_key',
  'apikey',
  'secret',
  'authorization',
  'phone_number',
  'email',
];

export function redactSensitiveData(data: unknown): unknown {
  if (!data || typeof data !== 'object') return data;

  if (Array.isArray(data)) {
    return data.map(redactSensitiveData);
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    const isSensitive = SENSITIVE_KEYS.some((k) => key.toLowerCase().includes(k));
    if (isSensitive && typeof value === 'string') {
      sanitized[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = redactSensitiveData(value);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

export const logger = {
  debug: (message: string, meta?: unknown) => log(LogLevel.DEBUG, message, meta),
  info: (message: string, meta?: unknown) => log(LogLevel.INFO, message, meta),
  warn: (message: string, meta?: unknown) => log(LogLevel.WARN, message, meta),
  error: (message: string, meta?: unknown) => log(LogLevel.ERROR, message, meta),
};

function log(level: LogLevel, message: string, meta?: unknown) {
  const timestamp = new Date().toISOString();
  const entry: Record<string, unknown> = {
    timestamp,
    level,
    message,
  };

  if (meta !== undefined) {
    entry.meta = redactSensitiveData(meta);
  }

  const serialized = JSON.stringify(entry);
  if (level === LogLevel.ERROR) {
    console.error(serialized);
  } else if (level === LogLevel.WARN) {
    console.warn(serialized);
  } else {
    console.log(serialized);
  }
}
