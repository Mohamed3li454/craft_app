/**
 * Failure Progression & Anti-Loop Tracker (Phase 6)
 *
 * Deterministically tracks troubleshooting lifecycle progression across turns:
 * Attempt 1: initial_diagnosis
 * Attempt 2: alternative_branch (with bounded diagnostic signatures to avoid repeating)
 * Attempt 3: deep_investigation
 *
 * Strictly avoids naive keyword matching (e.g. 'Flutter', 'error', 'API')
 * and instead extracts bounded concrete technical action signatures.
 */

import { TroubleshootingProgression, TroubleshootingStage } from './types';
import { ConversationState, ConversationMessage } from '../conversation/types';

function normalize(text: string): string {
  if (!text) return '';
  return text
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/\u0640/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .trim();
}

interface DiagnosticSignaturePattern {
  readonly signature: string;
  readonly regex: RegExp;
  readonly description: string;
}

export class FailureProgressionTracker {
  // Explicit signals from user indicating a prior suggested solution failed
  private static readonly FAILURE_SIGNALS = [
    /لسه\s+نفس/i,
    /ما\s+اشتغلش/i,
    /مش\s+شغال\s+برضه/i,
    /ما\s+نفعش/i,
    /برضه\s+بيطلع\s+لي/i,
    /برضه\s+مش\s+راضي/i,
    /لسه\s+(?:الايرور|الخطا|المشكله)/i,
    /نفس\s+(?:الخطا|الايرور|المشكله)/i,
    /جربت\s+ومفيش\s+فايده/i,
    /مش\s+عارف\s+برضه/i,
    /\bstill\s+(?:not\s+working|failing|broken|getting\s+the\s+same)\b/i,
    /\bsame\s+error\b/i,
    /\bdidn'?t\s+(?:work|help|fix|solve)\b/i,
    /\bnot\s+working\s+either\b/i,
    /\bkeeps\s+failing\b/i,
  ];

  // Bounded concrete diagnostic signatures extracted from previous assistant turn
  private static readonly KNOWN_SIGNATURES: DiagnosticSignaturePattern[] = [
    {
      signature: 'init_state_initialization',
      regex: /\binitstate\b/i,
      description: 'Variable initialization inside initState()',
    },
    {
      signature: 'flutter_clean_and_pub_get',
      regex: /flutter\s+clean/i,
      description: 'Running flutter clean and pub get',
    },
    {
      signature: 'pubspec_yaml_dependency',
      regex: /pubspec\.yaml/i,
      description: 'Modifying pubspec.yaml dependencies',
    },
    {
      signature: 'cors_headers_configuration',
      regex: /\bcors\b|access-control-allow-origin/i,
      description: 'Configuring CORS headers or origin policies',
    },
    {
      signature: 'docker_compose_restart',
      regex: /docker[\s-]compose\s+(?:up|down|restart)/i,
      description: 'Rebuilding or restarting Docker compose containers',
    },
    {
      signature: 'npm_install_clean_cache',
      regex: /npm\s+cache\s+clean|rm\s+-rf\s+node_modules/i,
      description: 'Clearing node_modules or npm cache',
    },
    {
      signature: 'database_indexing',
      regex: /create\s+index|btree\s+index/i,
      description: 'Adding PostgreSQL database indexes',
    },
    {
      signature: 'chmod_file_permissions',
      regex: /chmod\s+[0-9+x]+/i,
      description: 'Modifying file permissions via chmod',
    },
    {
      signature: 'dotenv_env_variables',
      regex: /\.env\b|process\.env/i,
      description: 'Setting environment variables in .env',
    },
  ];

  /**
   * Tracks troubleshooting progression and extracts anti-loop negative guardrails.
   */
  public static track(
    query: string,
    conversationState: ConversationState,
    recentMessages: readonly ConversationMessage[] = [],
    previousAssistantMessage?: string
  ): TroubleshootingProgression | undefined {
    // Only applies if conversation goal is troubleshooting
    if (conversationState.goal !== 'troubleshooting') {
      return undefined;
    }

    // If already resolved, return closure stage
    if (conversationState.resolutionState === 'resolved') {
      return {
        stage: 'closure',
        attemptNumber: 1,
        previousFailedApproaches: [],
        avoidRepeating: [],
        nextHypothesisHint: 'Issue is confirmed resolved. Conclude courteously.',
      };
    }

    const norm = normalize(query);
    const isFailureReport = this.FAILURE_SIGNALS.some((p) => p.test(norm));

    // Extract diagnostic signature from prior assistant message if available
    const avoidRepeating: string[] = [];
    const previousFailedApproaches: string[] = [];

    if (previousAssistantMessage) {
      for (const sig of this.KNOWN_SIGNATURES) {
        if (sig.regex.test(previousAssistantMessage)) {
          previousFailedApproaches.push(sig.signature);
          if (isFailureReport) {
            avoidRepeating.push(sig.description);
          }
        }
      }
    }

    // Determine attempt count by looking at prior user messages with failure signals
    let failureCount = 0;
    for (const msg of recentMessages) {
      if (msg.role === 'user') {
        const msgNorm = normalize(msg.text);
        if (this.FAILURE_SIGNALS.some((p) => p.test(msgNorm))) {
          failureCount++;
        }
      }
    }
    if (isFailureReport) {
      failureCount++;
    }

    // Determine Stage
    let stage: TroubleshootingStage = 'initial_diagnosis';
    let nextHypothesisHint = 'Provide the primary, most probable root cause and direct fix.';

    if (failureCount >= 2) {
      stage = 'deep_investigation';
      nextHypothesisHint = 'Multiple standard fixes have failed. Request minimal reproducible code snippet or full stack trace.';
    } else if (failureCount === 1) {
      stage = 'alternative_branch';
      nextHypothesisHint = 'The first suggested solution failed. Pivot to alternative diagnostic branch; do not repeat previous advice.';
    }

    const attemptNumber = Math.max(1, failureCount + 1);

    return {
      stage,
      attemptNumber,
      previousFailedApproaches: Object.freeze(previousFailedApproaches),
      avoidRepeating: Object.freeze(avoidRepeating),
      nextHypothesisHint,
    };
  }
}
