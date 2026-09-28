/**
 * In-Turn Proactive Prompt Builder (Phase 7.1)
 *
 * Produces a minimal, non-bloated LLM directive (strictly under 40 words)
 * guiding the model to offer a concise next-step or follow-up offer without
 * promising autonomous future outreach.
 */

import { ProactivePolicy } from './types';

export function buildProactivePrompt(policy?: ProactivePolicy): string {
  if (!policy || !policy.shouldSuggest || policy.suggestionType === 'none') {
    return '';
  }

  if (policy.suggestionType === 'next_step') {
    return [
      '### Proactive Guidance:',
      'Concisely suggest one natural next diagnostic step at the end of the response.',
      'Do not interrupt the answer. Never promise autonomous future contact.',
    ].join('\n');
  }

  if (policy.suggestionType === 'follow_up_offer') {
    return [
      '### Proactive Guidance:',
      'Offer one concise follow-up option if the user needs further assistance.',
      'Do not interrupt the answer. Never promise autonomous future contact.',
    ].join('\n');
  }

  return '';
}
