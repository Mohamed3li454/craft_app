/**
 * Prompt Builder for Adaptive Response Policy (Phase 6)
 *
 * Translates an immutable AdaptiveResponsePolicy into 3 to 6 compact, actionable lines (< 60 words).
 * Strictly prevents prompt bloat while enforcing negative guardrails.
 */

import { AdaptiveResponsePolicy } from './types';

function formatStrategy(strategy: string): string {
  return strategy
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export function buildAdaptiveResponsePrompt(policy: AdaptiveResponsePolicy): string {
  // If policy is neutral baseline with no directives, omit the section to save context window
  if (!policy || policy.instructions.length === 0) {
    return '';
  }

  const lines: string[] = ['### Adaptive Response Policy:'];

  // 1. Strategy & Structure
  lines.push(`- Strategy: ${formatStrategy(policy.strategy)} | Structure: ${formatStrategy(policy.structure)}`);

  // 2. Complexity & Depth
  lines.push(`- Complexity: ${policy.complexity.toUpperCase()} | Depth: ${policy.depth.toUpperCase()}`);

  // 3. Troubleshooting Progression & Anti-Loop (if applicable)
  if (policy.troubleshooting && policy.troubleshooting.stage !== 'closure') {
    if (policy.troubleshooting.avoidRepeating.length > 0) {
      lines.push(`- Anti-Loop Guard: Do NOT repeat previously failed approach: ${policy.troubleshooting.avoidRepeating.join(', ')}.`);
    }
    if (policy.troubleshooting.nextHypothesisHint) {
      lines.push(`- Progression: ${policy.troubleshooting.nextHypothesisHint}`);
    }
  }

  // 4. Concrete Actionable Directives (Max 2-3 bullet lines, avoiding redundancy)
  const filteredDirectives = policy.instructions
    .filter((dir) => !dir.startsWith('DO NOT repeat') || !policy.troubleshooting?.avoidRepeating?.length)
    .slice(0, 3);

  if (filteredDirectives.length > 0) {
    lines.push('- Directives:');
    for (const dir of filteredDirectives) {
      lines.push(`  • ${dir}`);
    }
  }

  return lines.join('\n');
}
