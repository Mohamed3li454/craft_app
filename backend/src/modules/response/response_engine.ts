/**
 * Adaptive Response Intelligence Master Engine (Phase 6)
 *
 * Coordinates complexity analysis, clarification gating, failure-aware progression,
 * strategy selection, and tool hint formulation.
 *
 * Execution Invariants:
 * - 100% deterministic, local TypeScript (< 2.0ms latency).
 * - Zero external API or LLM calls.
 * - Zero additional database queries.
 * - Does not mutate raw messages or conversation state.
 */

import {
  AdaptiveResponseInput,
  AdaptiveResponsePolicy,
  ToolHint,
} from './types';
import { ComplexityClassifier } from './complexity_classifier';
import { ClarificationGate } from './clarification_gate';
import { FailureProgressionTracker } from './failure_progression';
import { StrategySelector } from './strategy_selector';
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

export class AdaptiveResponseEngine {
  private static instance: AdaptiveResponseEngine | null = null;

  public static getInstance(): AdaptiveResponseEngine {
    if (!AdaptiveResponseEngine.instance) {
      AdaptiveResponseEngine.instance = new AdaptiveResponseEngine();
    }
    return AdaptiveResponseEngine.instance;
  }

  // Keywords indicating real-time / web lookups
  private static readonly SEARCH_KEYWORDS = [
    'سعر', 'اسعار', 'بكام', 'price', 'cost', 'مواصفات', 'specs', 'تسريبات', 'leaks',
    'احدث', 'اخبار', 'news', 'gold', 'ذهب', 'دولار', 'سعر الصرف', 'exchange rate',
  ];

  // Technical keywords to enforce memory boundary
  private static readonly TECHNICAL_KEYWORDS = [
    'code', 'function', 'class', 'api', 'database', 'db', 'query', 'sql',
    'framework', 'architecture', 'state', 'state management', 'backend', 'frontend', 'mobile',
    'app', 'component', 'widget', 'deployment', 'docker', 'server', 'debug', 'git',
    'endpoint', 'variable', 'loop', 'c++', 'allocator', 'memory',
    'كود', 'برمجة', 'دالة', 'كلاس', 'قاعدة بيانات', 'معمارية', 'إدارة الحالة',
    'باك اند', 'فرونت اند', 'تطبيق', 'مكتبة', 'سيرفر', 'هيكلة', 'ثغرة', 'متغيرات',
  ];

  /**
   * Analyzes conversation context and produces an immutable AdaptiveResponsePolicy.
   */
  public analyze(input: AdaptiveResponseInput): AdaptiveResponsePolicy {
    const rawQuery = (input.query || '').trim();
    const norm = normalize(rawQuery);

    // 1. Complexity Classification
    const complexity = ComplexityClassifier.classify(rawQuery);

    // 2. Clarification Evaluation
    const clarification = ClarificationGate.evaluate(
      rawQuery,
      input.conversationState,
      input.recentMessages || []
    );

    // 3. Troubleshooting Failure & Anti-Loop Progression
    const troubleshooting = FailureProgressionTracker.track(
      rawQuery,
      input.conversationState,
      input.recentMessages || [],
      input.previousAssistantMessage
    );

    // 4. Strategy & Structure Selection
    const { strategy, structure } = StrategySelector.select(
      rawQuery,
      complexity,
      input.conversationState,
      clarification,
      input.personalizationPolicy
    );

    // 5. Tool Hints Formulation
    const toolHints = this.formulateToolHints(rawQuery, norm, input.conversationState.goal);

    // 6. Technical Depth Resolution (Enforcing strict Memory Boundary)
    const isTechnical = AdaptiveResponseEngine.TECHNICAL_KEYWORDS.some((kw) => norm.includes(kw));
    const runtimeDirectives = extractRuntimeDirectives(rawQuery);

    let depth: 'minimal' | 'standard' | 'deep' = 'standard';

    // Tier 2: Explicit current instruction overrides all
    if (
      runtimeDirectives.verbosityOverride === 'concise' ||
      norm.includes('باختصار') ||
      norm.includes('في سطرين') ||
      norm.includes('اسهل') ||
      norm.includes('ببساطه') ||
      norm.includes('simpler') ||
      norm.includes('easier')
    ) {
      depth = 'minimal';
    } else if (runtimeDirectives.verbosityOverride === 'comprehensive' || norm.includes('بالتفصيل')) {
      depth = 'deep';
    } else if (isTechnical) {
      // Memory only applies to technical queries
      if (input.personalizationPolicy?.technicalDepth === 'advanced') {
        depth = 'deep';
      } else if (input.personalizationPolicy?.technicalDepth === 'foundational') {
        depth = 'minimal';
      } else if (complexity === 'complex') {
        depth = 'deep';
      } else if (complexity === 'simple') {
        depth = 'minimal';
      }
    } else {
      // Non-technical queries (e.g. recipes, geography) get minimal or standard depth
      depth = complexity === 'simple' ? 'minimal' : 'standard';
    }

    // 7. Negative Guardrails Synthesis
    const negativeGuardrails: string[] = [];
    if (troubleshooting && troubleshooting.avoidRepeating.length > 0) {
      for (const avoid of troubleshooting.avoidRepeating) {
        negativeGuardrails.push(`Do NOT repeat the previously failed solution: ${avoid}`);
      }
    }
    if (input.personalizationPolicy?.negativeGuardrails) {
      negativeGuardrails.push(...input.personalizationPolicy.negativeGuardrails);
    }
    // Conflict check: Current query specifies Python while memories mention Flutter
    if (input.personalizationPolicy?.domainFraming === 'python' || norm.includes('python') || norm.includes('بايثون')) {
      if (
        (input.retrievedMemories && input.retrievedMemories.some((m) => m.factText.toLowerCase().includes('flutter'))) ||
        negativeGuardrails.some((g) => g.toLowerCase().includes('other technologies'))
      ) {
        negativeGuardrails.push('Do NOT mention or frame examples in Flutter; current query specifically targets Python.');
      }
    }

    // 8. Concrete Actionable Directives (3 to 6 high-impact instructions)
    const instructions = this.generateDirectives(
      strategy,
      depth,
      structure,
      clarification,
      troubleshooting,
      toolHints,
      isTechnical
    );

    return Object.freeze({
      strategy,
      complexity,
      depth,
      structure,
      clarification: Object.freeze(clarification),
      troubleshooting: troubleshooting ? Object.freeze(troubleshooting) : undefined,
      toolHints: Object.freeze(toolHints),
      negativeGuardrails: Object.freeze(negativeGuardrails),
      instructions: Object.freeze(instructions),
      confidence: 0.95,
    });
  }

  private formulateToolHints(
    rawQuery: string,
    norm: string,
    goal: string
  ): ToolHint {
    // 1. Reminders
    if (
      norm.includes('فكرني') ||
      norm.includes('ذكرني') ||
      norm.includes('تذكير') ||
      norm.includes('remind')
    ) {
      return {
        shouldCallTool: true,
        suggestedTool: 'create_reminder',
        reason: 'User explicitly requested a reminder / task scheduling.',
      };
    }

    // 2. Weather
    if (norm.includes('الطقس') || norm.includes('جو ايه') || norm.includes('weather')) {
      return {
        shouldCallTool: true,
        suggestedTool: 'get_weather',
        reason: 'User requested live weather conditions.',
      };
    }

    // 3. Time
    if (norm.includes('الساعه كام') || norm.includes('الوقت كام') || norm.includes('current time')) {
      return {
        shouldCallTool: true,
        suggestedTool: 'get_current_time',
        reason: 'User requested the exact local time.',
      };
    }

    // 4. Live Search
    if (AdaptiveResponseEngine.SEARCH_KEYWORDS.some((kw) => norm.includes(kw))) {
      return {
        shouldCallTool: true,
        suggestedTool: 'web_search',
        reason: 'Query requests live market prices, hardware specs, or recent news.',
      };
    }

    // Default: Internal AI reasoning without external tools
    return {
      shouldCallTool: false,
      reason: 'General knowledge, code, or conceptual query; tools are not required.',
    };
  }

  private generateDirectives(
    strategy: string,
    depth: string,
    structure: string,
    clarification: any,
    troubleshooting: any,
    toolHints: ToolHint,
    isTechnical: boolean
  ): string[] {
    const directives: string[] = [];

    // Clarification Directive
    if (clarification.required) {
      directives.push('Ask the targeted clarification question directly and crisply without preamble.');
      if (clarification.suggestedOptions && clarification.suggestedOptions.length > 0) {
        directives.push(`Offer distinct options to guide the user: ${clarification.suggestedOptions.join(', ')}.`);
      }
      return directives;
    }

    // Strategy Directives
    switch (strategy) {
      case 'direct_answer':
        directives.push('Get straight to the answer without introductory preamble or conversational padding.');
        break;
      case 'code_first':
        directives.push('Present the complete, working code block immediately first, followed by concise usage notes.');
        break;
      case 'step_by_step_guide':
        directives.push('Provide a clear, progressive step-by-step workflow numbered sequentially.');
        break;
      case 'comparative_analysis':
        directives.push('Structure the comparison into balanced bullet points analyzing pros, cons, and trade-offs.');
        break;
      case 'executive_summary':
        directives.push('Distill the topic into a high-level executive summary with key takeaways.');
        break;
      case 'troubleshooting_flow':
        if (troubleshooting?.stage === 'alternative_branch') {
          directives.push('The previous solution failed. Open with the alternative diagnostic hypothesis directly.');
        } else if (troubleshooting?.stage === 'deep_investigation') {
          directives.push('Multiple fixes have failed. Request minimal reproducible code or full stack trace.');
        } else {
          directives.push('Diagnose the root cause and provide the most probable immediate fix.');
        }
        break;
      case 'conceptual_explanation':
      default:
        directives.push('Explain the concept clearly from first principles with intuitive real-world analogies.');
        break;
    }

    // Anti-Loop Directive
    if (troubleshooting && troubleshooting.avoidRepeating.length > 0) {
      directives.push(`DO NOT repeat the previous advice regarding: ${troubleshooting.avoidRepeating.join(', ')}.`);
    }

    // Depth Directive
    if (depth === 'minimal') {
      directives.push('Keep the response highly concise (max 2-3 sentences or focused bullet points).');
    } else if (depth === 'deep') {
      directives.push('Provide in-depth architectural reasoning and best-practice considerations.');
    }

    // Tool Hint Directive
    if (toolHints.shouldCallTool && toolHints.suggestedTool) {
      directives.push(`Invoke the '${toolHints.suggestedTool}' tool to obtain verified live data.`);
    }

    return directives;
  }
}
