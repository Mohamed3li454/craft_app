/**
 * Core type definitions for Craft True Personalization Engine (Phase 4)
 *
 * Strictly deterministic, decoupled from LLM providers, and adherence to
 * the 7-tier precedence hierarchy.
 */

import { FormalityLevel, VerbosityLevel, ExplicitPersonalityPreference } from '../personality/types';

export type PersonalizationSignalSource =
  | 'current_intent'
  | 'current_instruction'
  | 'stored_preference'
  | 'current_context'
  | 'active_memory'
  | 'historical_memory'
  | 'default_baseline';

export type PersonalizationDimension =
  | 'technical_depth'
  | 'domain_framing'
  | 'code_snippet'
  | 'explanation_style'
  | 'verbosity'
  | 'formality';

export type TechnicalDepth = 'foundational' | 'intermediate' | 'advanced';
export type CodeSnippetPolicy = 'none' | 'concise' | 'complete' | 'standard';
export type ExplanationStyle = 'direct' | 'step_by_step' | 'consultative';

export interface PersonalizationSignal {
  readonly source: PersonalizationSignalSource;
  readonly dimension: PersonalizationDimension;
  readonly value: string;
  readonly confidence: number;
  readonly relevanceScore?: number;
  readonly rawText?: string;
}

export interface PersonalizationDecision {
  readonly dimension: PersonalizationDimension;
  readonly appliedValue: string;
  readonly source: PersonalizationSignalSource;
  readonly reason: string;
  readonly suppressedSignals: ReadonlyArray<{
    readonly source: PersonalizationSignalSource;
    readonly value: string;
    readonly reason: string;
  }>;
}

export interface PersonalizationPolicy {
  readonly technicalDepth: TechnicalDepth;
  readonly domainFraming: string | null;
  readonly codeSnippetPolicy: CodeSnippetPolicy;
  readonly explanationStyle: ExplanationStyle;
  readonly verbosityOverride?: VerbosityLevel;
  readonly formalityOverride?: FormalityLevel;
  readonly negativeGuardrails: readonly string[];
  readonly decisions: readonly PersonalizationDecision[];
}

export interface RetrievedMemoryCandidate {
  readonly factText: string;
  readonly category: string;
  readonly factKey?: string;
  readonly lifecycleStatus?: string;
  readonly status?: string;
  readonly confidence?: number;
  readonly importance?: string;
  readonly temporalState?: 'historical' | 'current' | 'planned' | 'temporary' | 'unknown';
  readonly isHistorical?: boolean;
}

export interface PersonalizationInput {
  readonly query: string;
  readonly currentInstruction?: string;
  readonly recentContext?: ReadonlyArray<{ readonly role: string; readonly content: string }>;
  readonly storedPreferences?: {
    readonly language?: { readonly language: string; readonly dialect?: string };
    readonly personality?: ExplicitPersonalityPreference;
  };
  readonly retrievedMemories?: ReadonlyArray<RetrievedMemoryCandidate>;
}
