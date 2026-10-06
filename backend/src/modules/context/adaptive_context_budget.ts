/**
 * Adaptive Context Budget Manager (Phase 14.5)
 *
 * Implements task-adaptive token and context budgeting across 4 modes:
 * - MINIMAL: Pure conversational greetings/pleasantries (minimal history, zero search/memory waste)
 * - STANDARD: Single-turn informational, conceptual, or transactional requests
 * - RICH: Complex multi-source requests (search + memory + deep history)
 * - MULTI_STEP: Multi-step agent execution preserving all step dependencies and verified observations
 *
 * Invariant: Budget constraints MUST NEVER truncate CRITICAL context items!
 */

import {
  ContextBudgetMode,
  ContextItem,
  AdaptiveBudgetLimits,
} from './context_deduplicator.types';
import { TokenCounter } from './token_counter';

export interface BudgetResolutionInput {
  readonly userQuery: string;
  readonly triggerType?: string;
  readonly hasTools?: boolean;
  readonly stepCount?: number;
  readonly isGreeting?: boolean;
  readonly requiresSearch?: boolean;
}

export class AdaptiveContextBudgetManager {
  private static readonly MODE_LIMITS: Record<ContextBudgetMode, AdaptiveBudgetLimits> = {
    MINIMAL: {
      maxHistoryChars: 400,
      maxMemoryItems: 0,
      maxSearchItems: 0,
      allowProactiveSuggestions: false,
      allowSupplementalContext: false,
      targetTokenCeiling: 800,
    },
    STANDARD: {
      maxHistoryChars: 1200,
      maxMemoryItems: 3,
      maxSearchItems: 3,
      allowProactiveSuggestions: false,
      allowSupplementalContext: true,
      targetTokenCeiling: 1800,
    },
    RICH: {
      maxHistoryChars: 2500,
      maxMemoryItems: 5,
      maxSearchItems: 8,
      allowProactiveSuggestions: true,
      allowSupplementalContext: true,
      targetTokenCeiling: 3200,
    },
    MULTI_STEP: {
      maxHistoryChars: 2500,
      maxMemoryItems: 5,
      maxSearchItems: 8,
      allowProactiveSuggestions: false,
      allowSupplementalContext: true,
      targetTokenCeiling: 4500,
    },
  };

  /**
   * Resolves the appropriate ContextBudgetMode dynamically based on task signals.
   */
  public static resolveBudgetMode(input: BudgetResolutionInput): ContextBudgetMode {
    // 1. Multi-Step Execution: Active execution loop always takes MULTI_STEP mode
    if ((input.stepCount && input.stepCount > 0) || input.triggerType === 'multi_step') {
      return 'MULTI_STEP';
    }

    const query = (input.userQuery || '').trim();

    // 2. Minimal: Pure greetings, pleasantries, or short acknowledgments
    if (input.isGreeting || this.isPureGreetingOrPleasantry(query)) {
      return 'MINIMAL';
    }

    // 3. Rich: Search requested, product comparisons, or complex cross-topic requests
    if (input.requiresSearch || this.isComplexOrRichQuery(query)) {
      return 'RICH';
    }

    // 4. Standard: Default for informational, conceptual, or programming requests
    return 'STANDARD';
  }

  /**
   * Retrieves static budget limits for a given mode.
   */
  public static getLimitsForMode(mode: ContextBudgetMode): AdaptiveBudgetLimits {
    return this.MODE_LIMITS[mode] || this.MODE_LIMITS.STANDARD;
  }

  /**
   * Allocates context items according to strict priority order within the adaptive budget ceiling:
   * 1. CRITICAL items are ALWAYS preserved (Invariant: never truncated by budget).
   * 2. HIGH priority items are added up to remaining tokens.
   * 3. MEDIUM priority items are added up to remaining tokens.
   * 4. LOW priority items are pruned first if budget is constrained.
   */
  public static allocateItemsWithinBudget(
    items: readonly ContextItem[],
    mode: ContextBudgetMode,
    customTokenCeiling?: number
  ): {
    readonly allocatedItems: ContextItem[];
    readonly prunedItems: ContextItem[];
    readonly totalAllocatedTokens: number;
  } {
    const limits = this.getLimitsForMode(mode);
    const tokenCeiling = customTokenCeiling || limits.targetTokenCeiling;

    // Partition by priority
    const criticalItems: ContextItem[] = [];
    const highItems: ContextItem[] = [];
    const mediumItems: ContextItem[] = [];
    const lowItems: ContextItem[] = [];

    for (const item of items) {
      if (item.priority === 'CRITICAL' || item.source === 'CURRENT_MESSAGE') {
        criticalItems.push(item);
      } else if (item.priority === 'HIGH') {
        highItems.push(item);
      } else if (item.priority === 'MEDIUM') {
        mediumItems.push(item);
      } else {
        lowItems.push(item);
      }
    }

    const allocated: ContextItem[] = [];
    const pruned: ContextItem[] = [];
    let currentTokens = 0;

    // Phase A: ALWAYS allocate all CRITICAL items unconditionally
    for (const item of criticalItems) {
      const tokens = TokenCounter.countTokens(item.content);
      currentTokens += tokens;
      allocated.push(item);
    }

    // Phase B: Allocate HIGH priority items
    for (const item of highItems) {
      const tokens = TokenCounter.countTokens(item.content);
      if (currentTokens + tokens <= tokenCeiling || allocated.length < 2) {
        currentTokens += tokens;
        allocated.push(item);
      } else {
        pruned.push(item);
      }
    }

    // Phase C: Allocate MEDIUM priority items
    for (const item of mediumItems) {
      const tokens = TokenCounter.countTokens(item.content);
      if (currentTokens + tokens <= tokenCeiling) {
        currentTokens += tokens;
        allocated.push(item);
      } else {
        pruned.push(item);
      }
    }

    // Phase D: Allocate LOW priority items only if significant budget remains
    for (const item of lowItems) {
      const tokens = TokenCounter.countTokens(item.content);
      if (currentTokens + tokens <= tokenCeiling * 0.9) {
        currentTokens += tokens;
        allocated.push(item);
      } else {
        pruned.push(item);
      }
    }

    return {
      allocatedItems: allocated,
      prunedItems: pruned,
      totalAllocatedTokens: currentTokens,
    };
  }

  private static isPureGreetingOrPleasantry(query: string): boolean {
    const text = query
      .trim()
      .toLowerCase()
      .replace(/[\u064B-\u065F\u0670]/g, '');
    const greetings = [
      'السلام عليكم ورحمة الله', 'السلام عليكم', 'سلام عليكم', 'وعليكم السلام',
      'صباح الخير', 'مساء الخير', 'عامل ايه', 'عامل اي', 'اخبارك ايه', 'اخبارك',
      'ازيك', 'مرحبا', 'اهلا وسهلا', 'اهلين', 'اهلا', 'هاي', 'هالو', 'الو',
      'شكرا جزيلا', 'الف شكر', 'شكرا', 'تسلم', 'الله يخليك',
      'تمام', 'ماشي', 'اوك', 'اوكي', 'حلو', 'كويس', 'عظيم',
      'good morning', 'good evening', 'how are you', 'thank you', 'thanks',
      'hello', 'cool', 'great', 'okay', 'fine', 'there', 'hey', 'hi', 'ok'
    ];
    let stripped = text;
    for (const g of greetings) {
      stripped = stripped.replace(new RegExp(g, 'gi'), ' ');
    }
    stripped = stripped.replace(/[\s!؟?.,،\-~]+/g, '').trim();
    return stripped.length === 0;
  }

  private static isComplexOrRichQuery(query: string): boolean {
    const text = query.toLowerCase();
    const richIndicators = [
      'قارن', 'مقارنة', 'ابحث', 'سعر', 'آخر أخبار', 'اخر اخبار', 'تسريبات', 'مواصفات',
      'compare', 'comparison', 'search', 'latest', 'news', 'vs', 'versus', 'price'
    ];
    return richIndicators.some((ind) => text.includes(ind));
  }
}
