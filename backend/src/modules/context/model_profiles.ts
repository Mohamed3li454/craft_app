/**
 * Model Context Profiles (Phase 8.1)
 *
 * Defines known model context boundaries, output reserve allowances, and safety margins
 * for Groq LPUs and supported fallback architectures.
 */

import { ModelContextProfile } from './token_budget.types';

export const DEFAULT_MODEL_PROFILE: ModelContextProfile = {
  modelId: 'default-fallback',
  contextWindowTokens: 8192,
  outputReserveTokens: 2048,
  defaultSafetyTokens: 1000,
};

export const MODEL_CONTEXT_PROFILES: Record<string, ModelContextProfile> = {
  'openai/gpt-oss-120b': {
    modelId: 'openai/gpt-oss-120b',
    contextWindowTokens: 128000,
    outputReserveTokens: 4096,
    defaultSafetyTokens: 1500,
  },
  'openai/gpt-oss-20b': {
    modelId: 'openai/gpt-oss-20b',
    contextWindowTokens: 128000,
    outputReserveTokens: 4096,
    defaultSafetyTokens: 1500,
  },
  'qwen/qwen3.8-27b': {
    modelId: 'qwen/qwen3.8-27b',
    contextWindowTokens: 32768,
    outputReserveTokens: 4096,
    defaultSafetyTokens: 1200,
  },
  'llama-3.3-70b-versatile': {
    modelId: 'llama-3.3-70b-versatile',
    contextWindowTokens: 128000,
    outputReserveTokens: 4096,
    defaultSafetyTokens: 1500,
  },
  'llama-3.1-8b-instant': {
    modelId: 'llama-3.1-8b-instant',
    contextWindowTokens: 128000,
    outputReserveTokens: 4096,
    defaultSafetyTokens: 1500,
  },
  'mixtral-8x7b-32768': {
    modelId: 'mixtral-8x7b-32768',
    contextWindowTokens: 32768,
    outputReserveTokens: 4096,
    defaultSafetyTokens: 1200,
  },
  'gemma2-9b-it': {
    modelId: 'gemma2-9b-it',
    contextWindowTokens: 8192,
    outputReserveTokens: 2048,
    defaultSafetyTokens: 1000,
  },
};

/**
 * Retrieves the context profile for a given model ID or returns the conservative fallback profile.
 */
export function getModelProfile(modelId?: string): ModelContextProfile {
  if (!modelId) {
    return DEFAULT_MODEL_PROFILE;
  }

  const normalized = modelId.trim().toLowerCase();

  // Exact match
  if (MODEL_CONTEXT_PROFILES[normalized]) {
    return MODEL_CONTEXT_PROFILES[normalized];
  }

  // Partial/prefix match
  for (const [key, profile] of Object.entries(MODEL_CONTEXT_PROFILES)) {
    if (normalized.includes(key) || key.includes(normalized)) {
      return profile;
    }
  }

  return {
    modelId,
    contextWindowTokens: DEFAULT_MODEL_PROFILE.contextWindowTokens,
    outputReserveTokens: DEFAULT_MODEL_PROFILE.outputReserveTokens,
    defaultSafetyTokens: DEFAULT_MODEL_PROFILE.defaultSafetyTokens,
  };
}
