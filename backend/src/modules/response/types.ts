/**
 * Adaptive Response Intelligence Types (Phase 6)
 *
 * Core contracts for deterministic, provider-agnostic response strategy selection,
 * complexity grading, clarification gating, and failure progression tracking.
 */

import { ConversationState, ConversationMessage } from '../conversation/types';
import { PersonalizationPolicy } from '../personalization/types';
import { PersonalityContext } from '../personality/types';
import { LanguageContext } from '../language/types';

export type ResponseStrategy =
  | 'direct_answer'          // Direct, crisp answer for simple factual/syntax queries
  | 'conceptual_explanation' // Rich conceptual overview for high-level questions
  | 'step_by_step_guide'     // Procedural workflow for how-to / tutorials
  | 'troubleshooting_flow'   // Hypothesis-driven diagnostic & progressive fix
  | 'comparative_analysis'   // Side-by-side trade-off evaluation (A vs B)
  | 'code_first'             // Code implementation immediately followed by key notes
  | 'clarification_prompt'   // Crisp targeted question when critical info is missing
  | 'executive_summary';     // High-level distilled summary of complex text/topics

export type ResponseComplexity = 'simple' | 'moderate' | 'complex';

export type ResponseStructure =
  | 'concise_plain'          // 1-3 sentences
  | 'bullet_list'            // Bullet points for items/pros/cons
  | 'procedural_steps'       // Numbered 1, 2, 3 steps
  | 'code_with_explanation'  // Code block + bullet explanations
  | 'structured_sections'    // Headings with bold markers
  | 'clarification_question';// Targeted question with options/examples

export interface ClarificationDecision {
  readonly required: boolean;
  readonly reason?: 'missing_critical_context' | 'ambiguous_referent' | 'conflicting_options';
  readonly targetedAspect?: string;
  readonly suggestedClarification?: string;
  readonly suggestedOptions?: readonly string[];
}

export type TroubleshootingStage =
  | 'initial_diagnosis'
  | 'primary_fix'
  | 'alternative_branch'
  | 'deep_investigation'
  | 'closure';

export interface TroubleshootingProgression {
  readonly stage: TroubleshootingStage;
  readonly attemptNumber: number;
  readonly previousFailedApproaches: readonly string[];
  readonly avoidRepeating: readonly string[];
  readonly nextHypothesisHint?: string;
}

export interface ToolHint {
  readonly shouldCallTool: boolean;
  readonly suggestedTool?: string;
  readonly reason: string;
}

export interface AdaptiveResponsePolicy {
  readonly strategy: ResponseStrategy;
  readonly complexity: ResponseComplexity;
  readonly depth: 'minimal' | 'standard' | 'deep';
  readonly structure: ResponseStructure;
  readonly clarification: ClarificationDecision;
  readonly troubleshooting?: TroubleshootingProgression;
  readonly toolHints: ToolHint;
  readonly negativeGuardrails: readonly string[];
  readonly instructions: readonly string[]; // 3-6 actionable prompt instructions
  readonly confidence: number;
}

export interface RetrievedMemorySummary {
  readonly factText: string;
  readonly category?: string;
  readonly status?: string;
  readonly lifecycleStatus?: string;
}

export interface AdaptiveResponseInput {
  readonly query: string;
  readonly conversationState: ConversationState;
  readonly personalizationPolicy?: PersonalizationPolicy;
  readonly personalityContext?: PersonalityContext;
  readonly languageContext?: LanguageContext;
  readonly recentMessages?: readonly ConversationMessage[];
  readonly retrievedMemories?: readonly RetrievedMemorySummary[];
  readonly previousAssistantMessage?: string;
}
