/**
 * Conversation Intelligence Engine (Phase 5)
 *
 * Coordinates topic tracking, follow-up detection, goal classification,
 * and resolution state tracking.
 * Purely deterministic, O(N) complexity where N <= 10 turns, execution latency < 2ms.
 */

import {
  ConversationAnalysisInput,
  ConversationState,
} from './types';
import { TopicTracker } from './topic_tracker';
import { FollowUpDetector } from './follow_up_detector';
import { ResolutionTracker } from './resolution_tracker';

export class ConversationIntelligenceEngine {
  private static instance: ConversationIntelligenceEngine | null = null;

  public static getInstance(): ConversationIntelligenceEngine {
    if (!ConversationIntelligenceEngine.instance) {
      ConversationIntelligenceEngine.instance = new ConversationIntelligenceEngine();
    }
    return ConversationIntelligenceEngine.instance;
  }

  /**
   * Analyzes an incoming query in the context of recent messages to produce a deterministic ConversationState.
   */
  public analyze(input: ConversationAnalysisInput): ConversationState {
    const query = input.query || '';
    const recentMessages = input.recentMessages || [];
    const prevState = input.previousState;

    // 1. Goal & Resolution Tracking
    const goalResult = ResolutionTracker.analyze(
      query,
      recentMessages,
      prevState?.resolutionState || 'not_applicable'
    );

    // 2. Topic Tracking & Switching
    const turnIndex = recentMessages.length;
    const isCasual = goalResult.goal === 'casual';
    const topicResult = TopicTracker.trackTopic(
      query,
      prevState?.topicHistory || [],
      prevState?.activeTopic || null,
      turnIndex,
      isCasual
    );

    // 3. Follow-up & Dependency Analysis
    const followUpResult = FollowUpDetector.analyze(
      query,
      topicResult.activeTopic,
      recentMessages
    );

    // 4. Calculate Confidence
    let confidence = 0.85;
    if (followUpResult.isFollowUp && topicResult.activeTopic) {
      confidence = 0.95;
    } else if (topicResult.isTopicSwitch) {
      confidence = 0.90;
    } else if (recentMessages.length === 0) {
      confidence = 0.80;
    }

    return Object.freeze({
      activeTopic: topicResult.activeTopic,
      topicHistory: topicResult.topicHistory,
      isTopicSwitch: topicResult.isTopicSwitch,
      previousTopic: topicResult.previousTopic,
      isFollowUp: followUpResult.isFollowUp,
      requiresContext: followUpResult.requiresContext,
      contextualizedQuery: followUpResult.contextualizedQuery,
      goal: goalResult.goal,
      resolutionState: goalResult.resolutionState,
      unresolvedItems: goalResult.unresolvedItems,
      sessionEntities: topicResult.sessionEntities,
      confidence,
    });
  }
}
