import dotenv from 'dotenv';
import path from 'path';

// Load .env from backend directory if present
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export interface AppConfig {
  port: number;
  nodeEnv: string;
  corsOrigin: string;
  gemini: {
    apiKey: string;
    model: string;
    fallbackModel: string;
    isMockMode: boolean;
  };
  groq: {
    apiKey: string;
    primaryModel: string;
    fallbackModel: string;
    whisperModel: string;
    isMockMode: boolean;
  };
  database: {
    url?: string;
    supabaseUrl?: string;
    supabaseKey?: string;
  };
  whatsapp: {
    phoneNumberId?: string;
    accessToken?: string;
    verifyToken: string;
    appSecret?: string;
  };
  security: {
    maxIterations: number;
    toolTimeoutMs: number;
    confirmationExpiresMinutes: number;
  };
}

export const config: AppConfig = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  corsOrigin: process.env.CORS_ORIGIN || '*',
  gemini: {
    apiKey: process.env.GEMINI_API_KEY || '',
    model: process.env.GEMINI_MODEL || 'gemini-3.8-flash',
    fallbackModel: process.env.GEMINI_FALLBACK_MODEL || 'gemini-3.1-flash-lite',
    isMockMode:
      process.env.GEMINI_MOCK_MODE === 'true' ||
      !process.env.GEMINI_API_KEY ||
      process.env.GEMINI_API_KEY.startsWith('your_'),
  },
  groq: {
    apiKey: process.env.GROQ_API_KEY || '',
    primaryModel: process.env.GROQ_PRIMARY_MODEL || 'openai/gpt-oss-120b',
    fallbackModel: process.env.GROQ_FALLBACK_MODEL || 'qwen/qwen3.8-27b',
    whisperModel: process.env.GROQ_WHISPER_MODEL || 'whisper-large-v3-turbo',
    isMockMode:
      process.env.GEMINI_MOCK_MODE === 'true' ||
      process.env.GROQ_MOCK_MODE === 'true' ||
      !process.env.GROQ_API_KEY ||
      process.env.GROQ_API_KEY.startsWith('your_'),
  },
  database: {
    url: process.env.DATABASE_URL,
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  },
  whatsapp: {
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN,
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN || 'craft_secret_verify_token_2026',
    appSecret: process.env.WHATSAPP_APP_SECRET,
  },
  security: {
    maxIterations: parseInt(process.env.MAX_AGENT_ITERATIONS || '5', 10),
    toolTimeoutMs: parseInt(process.env.TOOL_TIMEOUT_MS || '8000', 10),
    confirmationExpiresMinutes: parseInt(process.env.CONFIRMATION_EXPIRES_MINUTES || '5', 10),
  },
};
