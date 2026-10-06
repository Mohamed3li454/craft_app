/**
 * Core type definitions for Craft Conversation Intelligence Engine (Phase 5)
 *
 * Provides a 100% deterministic, local, provider-agnostic representation
 * of real-time Conversation State, active topic tracking, follow-up detection,
 * goal categorization, and troubleshooting resolution status.
 */

export type ConversationGoal =
  | 'informational'      // Explanation, concepts, factual answers
  | 'troubleshooting'    // Diagnosing bugs, errors, build failures
  | 'planning'           // Architecture design, system planning, roadmap
  | 'implementation'     // Code generation, configuration, script writing
  | 'decision_support'   // Comparing technologies, trade-off analysis
  | 'transactional'      // Reminders, weather, time, direct tool actions
  | 'casual';            // Greetings, courtesy, chit-chat

export type ResolutionState =
  | 'not_applicable'     // General queries or non-problem dialogue
  | 'unresolved'         // Problem introduced, not yet addressed or diagnosed
  | 'in_progress'        // Diagnosis or steps provided, waiting on user feedback
  | 'resolved';          // User confirmed the issue is fixed

export interface TopicRecord {
  readonly topic: string;
  readonly domain: 'technical' | 'general' | 'transactional';
  readonly startedAtTurnIndex: number;
  readonly lastSeenAtTurnIndex: number;
  readonly isResolved?: boolean;
}

export interface ConversationMessage {
  readonly role: 'user' | 'assistant' | 'system' | 'tool';
  readonly text: string;
  readonly createdAt?: Date;
  readonly toolsUsed?: string;
}

export interface ConversationState {
  /** Currently active topic of the conversation */
  readonly activeTopic: string | null;
  /** History of all topics discussed across the session */
  readonly topicHistory: readonly TopicRecord[];
  /** Flag indicating if the current user message introduced a topic switch */
  readonly isTopicSwitch: boolean;
  /** The prior topic before the switch (if switched) */
  readonly previousTopic: string | null;
  /** Whether the current message is a follow-up continuation of recent context */
  readonly isFollowUp: boolean;
  /** Whether the current message cannot be understood in isolation without context */
  readonly requiresContext: boolean;
  /** Standalone enriched query string integrating context entities for retrieval & cache */
  readonly contextualizedQuery: string;
  /** Primary conversational goal */
  readonly goal: ConversationGoal;
  /** Resolution state of technical issue or question */
  readonly resolutionState: ResolutionState;
  /** Unresolved problems, errors, or open questions */
  readonly unresolvedItems: readonly string[];
  /** Session-bound ephemeral entities (tools/frameworks mentioned in session) */
  readonly sessionEntities: readonly string[];
  /** Confidence score of the conversation intelligence analysis (0.0 to 1.0) */
  readonly confidence: number;
}

export interface ConversationAnalysisInput {
  readonly query: string;
  readonly recentMessages: readonly ConversationMessage[];
  readonly previousState?: ConversationState;
}

export interface ContextWindowOptions {
  readonly maxCharacters?: number;
  readonly maxTurns?: number;
  readonly memoryContextFacts?: readonly string[];
  readonly budgetMode?: 'MINIMAL' | 'STANDARD' | 'RICH' | 'MULTI_STEP';
}
