/**
 * Strategy & Structure Selector for Adaptive Response Intelligence (Phase 6)
 *
 * Deterministically maps ConversationGoal, Complexity, Explicit Directives,
 * and Clarification Gates into an optimal ResponseStrategy and ResponseStructure.
 */

import {
  ResponseStrategy,
  ResponseStructure,
  ResponseComplexity,
  ClarificationDecision,
} from './types';
import { ConversationState } from '../conversation/types';
import { PersonalizationPolicy } from '../personalization/types';
import { extractRuntimeDirectives } from '../personalization/instruction_matcher';

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

export class StrategySelector {
  private static readonly COMPARISON_KEYWORDS = [
    'مقارنه', 'مفاضله', 'ايهما افضل', 'ايه افضل', 'ايه احسن', 'احسن ولا', 'افضل ولا',
    'الفرق بين', 'فرق بين', 'difference between',
    'compare', 'comparison', 'versus', ' vs ', 'which is better',
  ];

  private static readonly SUMMARY_KEYWORDS = [
    'لخص', 'ملخص', 'الخلاصه', 'تلخيص', 'summary', 'summarize', 'overview',
  ];

  private static readonly STEP_KEYWORDS = [
    'خطوه بخطوه', 'خطوات', 'step by step', 'how to', 'طريقه عمل', 'ازاي اعمل',
  ];

  /**
   * Selects response strategy and structure following the 7-tier precedence model.
   */
  public static select(
    query: string,
    complexity: ResponseComplexity,
    conversationState: ConversationState,
    clarification: ClarificationDecision,
    personalizationPolicy?: PersonalizationPolicy
  ): { strategy: ResponseStrategy; structure: ResponseStructure } {
    // 1. Tier 3: Clarification Gating
    if (clarification.required) {
      return {
        strategy: 'clarification_prompt',
        structure: 'clarification_question',
      };
    }

    const norm = normalize(query);
    const runtimeDirectives = extractRuntimeDirectives(query);

    // 2. Tier 2: Explicit Runtime User Directives
    // Summary
    if (this.SUMMARY_KEYWORDS.some((kw) => norm.includes(kw))) {
      return {
        strategy: 'executive_summary',
        structure: 'bullet_list',
      };
    }

    // Code-first (explicit code requested or complete code snippet policy)
    if (
      runtimeDirectives.codeSnippetPolicy === 'complete' ||
      norm.includes('اكتب كود') ||
      norm.includes('عايز كود') ||
      norm.includes('code only') ||
      norm.includes('write code')
    ) {
      return {
        strategy: 'code_first',
        structure: 'code_with_explanation',
      };
    }

    // Explanation-only (explicitly no code)
    if (runtimeDirectives.codeSnippetPolicy === 'none' || norm.includes('بدون كود') || norm.includes('نظريا')) {
      return {
        strategy: 'conceptual_explanation',
        structure: complexity === 'complex' ? 'structured_sections' : 'bullet_list',
      };
    }

    // Concise directive ("باختصار", "في سطرين")
    if (runtimeDirectives.verbosityOverride === 'concise' || norm.includes('باختصار') || norm.includes('في سطرين')) {
      return {
        strategy: 'direct_answer',
        structure: 'concise_plain',
      };
    }

    // Step-by-step directive
    if (runtimeDirectives.explanationStyle === 'step_by_step' || this.STEP_KEYWORDS.some((kw) => norm.includes(kw))) {
      return {
        strategy: 'step_by_step_guide',
        structure: 'procedural_steps',
      };
    }

    // Direct placement / short query ("أحطه فين", "where do I put", "كام")
    if (
      norm.includes('فين') ||
      norm.includes('where') ||
      (conversationState.isFollowUp && norm.length <= 35)
    ) {
      return {
        strategy: 'direct_answer',
        structure: 'concise_plain',
      };
    }

    // 3. Tier 4: Active Conversation State & Goal
    // Comparative analysis
    if (
      conversationState.goal === 'decision_support' ||
      this.COMPARISON_KEYWORDS.some((kw) => norm.includes(kw))
    ) {
      return {
        strategy: 'comparative_analysis',
        structure: 'bullet_list',
      };
    }

    // Troubleshooting
    if (conversationState.goal === 'troubleshooting') {
      if (conversationState.resolutionState === 'resolved') {
        return {
          strategy: 'direct_answer',
          structure: 'concise_plain',
        };
      }
      return {
        strategy: 'troubleshooting_flow',
        structure: 'procedural_steps',
      };
    }

    // Planning / Architecture
    if (conversationState.goal === 'planning') {
      return {
        strategy: 'conceptual_explanation',
        structure: 'structured_sections',
      };
    }

    // Implementation
    if (conversationState.goal === 'implementation') {
      return {
        strategy: 'code_first',
        structure: 'code_with_explanation',
      };
    }

    // Transactional (weather, reminder, time)
    if (conversationState.goal === 'transactional') {
      return {
        strategy: 'direct_answer',
        structure: 'concise_plain',
      };
    }

    // Casual (greetings, pleasantries)
    if (conversationState.goal === 'casual') {
      return {
        strategy: 'direct_answer',
        structure: 'concise_plain',
      };
    }

    // 4. Tier 7: Default Baseline from Complexity
    if (complexity === 'simple') {
      return {
        strategy: 'direct_answer',
        structure: 'concise_plain',
      };
    }

    if (complexity === 'complex') {
      return {
        strategy: 'conceptual_explanation',
        structure: 'structured_sections',
      };
    }

    // Moderate default
    return {
      strategy: 'conceptual_explanation',
      structure: 'bullet_list',
    };
  }
}
