/**
 * Prompt Builder for Tailored Response Policy (Phase 4)
 *
 * Translates an immutable PersonalizationPolicy into clear, actionable system instructions.
 * Strictly prevents prompt bloat while enforcing negative guardrails.
 */

import { PersonalizationPolicy } from './types';

export function buildPersonalizationPrompt(policy: PersonalizationPolicy): string {
  const lines: string[] = ['### Tailored Response Policy:'];
  let hasDirectives = false;

  // 1. Technical Depth
  if (policy.technicalDepth === 'advanced') {
    lines.push('- Technical Level: Advanced architectural level. Assume deep familiarity with engineering principles; focus on scalability, performance, and best practices.');
    hasDirectives = true;
  } else if (policy.technicalDepth === 'foundational') {
    lines.push('- Technical Level: Foundational and accessible. Explain concepts clearly from first principles with intuitive analogies.');
    hasDirectives = true;
  }

  // 2. Domain Framing
  if (policy.domainFraming) {
    const techDisplay = policy.domainFraming.charAt(0).toUpperCase() + policy.domainFraming.slice(1);
    lines.push(`- Domain Context: Frame technical examples and design patterns naturally around ${techDisplay}, unless the user explicitly requests another framework.`);
    hasDirectives = true;
  }

  // 3. Code Snippet Policy
  if (policy.codeSnippetPolicy === 'none') {
    lines.push('- Code Snippets: Do NOT include code snippets; explain conceptually and textually.');
    hasDirectives = true;
  } else if (policy.codeSnippetPolicy === 'complete') {
    lines.push('- Code Snippets: Provide complete, self-contained, and ready-to-run code implementation without skipping parts.');
    hasDirectives = true;
  } else if (policy.codeSnippetPolicy === 'concise') {
    lines.push('- Code Snippets: Keep code snippets concise and focused strictly on the core solution.');
    hasDirectives = true;
  }

  // 4. Explanation Style
  if (policy.explanationStyle === 'direct') {
    lines.push('- Explanation Style: Get straight to the direct solution immediately without introductory preamble or conversational padding.');
    hasDirectives = true;
  } else if (policy.explanationStyle === 'step_by_step') {
    lines.push('- Explanation Style: Provide a clear, progressive, step-by-step breakdown.');
    hasDirectives = true;
  }

  // 5. Negative Guardrails
  if (policy.negativeGuardrails.length > 0) {
    lines.push('- Negative Guardrails:');
    for (const guard of policy.negativeGuardrails) {
      lines.push(`  • ${guard}`);
    }
    hasDirectives = true;
  }

  if (!hasDirectives) {
    return '';
  }

  return lines.join('\n');
}
