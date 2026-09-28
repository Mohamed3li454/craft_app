/**
 * Craft True Personalization Engine (Phase 4)
 *
 * Implements a 100% deterministic, local, zero-LLM personalization system.
 * Follows the 7-tier precedence hierarchy:
 * 1. Current User Intent
 * 2. Explicit Current Instruction
 * 3. Explicit Persistent Preference
 * 4. Current Conversation Context
 * 5. Relevant Stable Memory
 * 6. Historical Context
 * 7. Default Baseline
 */

import {
  PersonalizationInput,
  PersonalizationPolicy,
  PersonalizationDecision,
  TechnicalDepth,
  CodeSnippetPolicy,
  ExplanationStyle,
  RetrievedMemoryCandidate,
  PersonalizationSignalSource,
} from './types';
import { extractRuntimeDirectives } from './instruction_matcher';

export class PersonalizationEngine {
  private static instance: PersonalizationEngine | null = null;

  public static getInstance(): PersonalizationEngine {
    if (!PersonalizationEngine.instance) {
      PersonalizationEngine.instance = new PersonalizationEngine();
    }
    return PersonalizationEngine.instance;
  }

  // Keywords indicating the query is technical / software related
  private static readonly TECHNICAL_KEYWORDS = [
    'code', 'function', 'functions', 'class', 'api', 'database', 'db', 'query', 'sql', 'nosql',
    'framework', 'architecture', 'state management', 'backend', 'frontend', 'mobile',
    'app', 'component', 'hook', 'widget', 'deployment', 'docker', 'kubernetes', 'server',
    'debug', 'compiler', 'library', 'package', 'git', 'endpoint', 'rest', 'graphql',
    'array', 'arrays', 'variable', 'variables', 'loop', 'object', 'method',
    'كود', 'برمجة', 'دالة', 'دوال', 'كلاس', 'قاعدة بيانات', 'معمارية', 'إدارة الحالة', 'باك اند',
    'فرونت اند', 'تطبيق', 'مكتبة', 'سيرفر', 'هيكلة', 'هندسة البرمجيات', 'أداء', 'ثغرة',
    'مصفوفات', 'مصفوفة', 'برمجية', 'برمجي', 'متغيرات', 'تطوير',
  ];

  // Specific technologies dictionary for recognition
  private static readonly KNOWN_TECH_KEYWORDS: Record<string, string[]> = {
    flutter: ['flutter', 'dart', 'فلاتر', 'دارت', 'widget', 'bloc', 'provider'],
    react: ['react', 'react native', 'jsx', 'tsx', 'رياكت', 'redux', 'next.js', 'nextjs'],
    python: ['python', 'django', 'fastapi', 'flask', 'بايثون', 'بانداز', 'pandas'],
    nodejs: ['node', 'nodejs', 'express', 'nestjs', 'typescript', 'نود'],
    golang: ['go', 'golang', 'قولانج', 'جو'],
    java: ['java', 'spring', 'springboot', 'جافا'],
    dotnet: ['c#', '.net', 'dotnet', 'asp.net', 'دوت نت', 'سي شارب'],
  };

  /**
   * Synthesizes an immutable PersonalizationPolicy from runtime inputs.
   */
  public synthesizePolicy(input: PersonalizationInput): PersonalizationPolicy {
    const decisions: PersonalizationDecision[] = [];
    const query = input.query || '';
    const normQuery = query.toLowerCase();

    // Step 1: Detect explicit runtime directives from current query (Tier 2)
    const runtimeDirectives = extractRuntimeDirectives(query);

    // Step 2: Determine if current query is technical (Scope Gating)
    const isTechnicalQuery = this.isTechnical(normQuery);

    // Step 3: Check Current Intent for specific technology mention (Tier 1)
    const querySpecificTech = this.detectExplicitTech(normQuery);

    // Step 4: Resolve Technical Depth & Domain Framing
    const { technicalDepth, domainFraming, depthDecision, domainDecision } =
      this.resolveTechnicalAndDomain(
        isTechnicalQuery,
        querySpecificTech,
        input.retrievedMemories || [],
        input.recentContext || []
      );
    decisions.push(depthDecision);
    decisions.push(domainDecision);

    // Step 5: Resolve Code Snippet Policy
    const { codeSnippetPolicy, codeDecision } = this.resolveCodeSnippetPolicy(
      runtimeDirectives.codeSnippetPolicy,
      isTechnicalQuery
    );
    decisions.push(codeDecision);

    // Step 6: Resolve Explanation Style
    const { explanationStyle, styleDecision } = this.resolveExplanationStyle(
      runtimeDirectives.explanationStyle,
      isTechnicalQuery,
      technicalDepth
    );
    decisions.push(styleDecision);

    // Step 7: Resolve Verbosity & Formality Overrides with Precedence
    const { verbosityOverride, verbosityDecision } = this.resolveVerbosity(
      runtimeDirectives.verbosityOverride,
      input.storedPreferences?.personality?.verbosity
    );
    if (verbosityDecision) decisions.push(verbosityDecision);

    const { formalityOverride, formalityDecision } = this.resolveFormality(
      runtimeDirectives.formalityOverride,
      input.storedPreferences?.personality?.formality
    );
    if (formalityDecision) decisions.push(formalityDecision);

    // Step 8: Build Anti-Over-Personalization Negative Guardrails
    const negativeGuardrails = this.buildNegativeGuardrails(
      isTechnicalQuery,
      domainFraming,
      querySpecificTech
    );

    return Object.freeze({
      technicalDepth,
      domainFraming,
      codeSnippetPolicy,
      explanationStyle,
      verbosityOverride,
      formalityOverride,
      negativeGuardrails: Object.freeze(negativeGuardrails),
      decisions: Object.freeze(decisions),
    });
  }

  /**
   * Evaluates if query relates to software / technical topics.
   */
  private isTechnical(normQuery: string): boolean {
    return PersonalizationEngine.TECHNICAL_KEYWORDS.some((kw) =>
      normQuery.includes(kw)
    );
  }

  /**
   * Detects if the current user query explicitly targets a specific technology.
   */
  private detectExplicitTech(normQuery: string): string | null {
    for (const [techKey, keywords] of Object.entries(PersonalizationEngine.KNOWN_TECH_KEYWORDS)) {
      if (keywords.some((kw) => {
        const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const pattern = new RegExp(`(?:^|\\s|[.,!؟()_\\-])${escaped}(?:$|\\s|[.,!؟()_\\-])`, 'i');
        return pattern.test(normQuery) || normQuery.includes(kw);
      })) {
        return techKey;
      }
    }
    return null;
  }

  /**
   * Resolves technical depth and domain framing following Tier 1 -> Tier 4 -> Tier 5 precedence.
   */
  private resolveTechnicalAndDomain(
    isTechnicalQuery: boolean,
    querySpecificTech: string | null,
    memories: ReadonlyArray<RetrievedMemoryCandidate>,
    recentContext: ReadonlyArray<{ readonly role: string; readonly content: string }>
  ): {
    technicalDepth: TechnicalDepth;
    domainFraming: string | null;
    depthDecision: PersonalizationDecision;
    domainDecision: PersonalizationDecision;
  } {
    // Non-technical query -> Strict gating: depth is foundational/default, domain is null.
    if (!isTechnicalQuery) {
      return {
        technicalDepth: 'foundational',
        domainFraming: null,
        depthDecision: {
          dimension: 'technical_depth',
          appliedValue: 'foundational',
          source: 'default_baseline',
          reason: 'Query is non-technical; technical depth kept at foundational baseline.',
          suppressedSignals: [],
        },
        domainDecision: {
          dimension: 'domain_framing',
          appliedValue: 'none',
          source: 'default_baseline',
          reason: 'Non-technical query; domain framing suppressed to avoid over-personalization.',
          suppressedSignals: memories
            .filter((m) => m.category === 'profession' || m.category === 'technical_context')
            .map((m) => ({
              source: 'active_memory' as PersonalizationSignalSource,
              value: m.factText,
              reason: 'Query is non-technical; profession/technical memory cannot be applied.',
            })),
        },
      };
    }

    // Technical query: inspect active, non-historical memories
    const validMemories = memories.filter((m) => {
      // Must not be historical or superseded
      if (m.isHistorical || m.temporalState === 'historical') return false;
      const status = m.status || m.lifecycleStatus;
      if (status && status !== 'active') return false;
      return true;
    });

    // Check seniority in active memories
    let detectedDepth: TechnicalDepth = 'intermediate';
    let depthSource: PersonalizationSignalSource = 'default_baseline';
    let depthReason = 'Standard technical query defaulted to intermediate level.';

    const seniorKeywords = ['senior', 'خبير', 'معماري', 'architect', 'lead', 'متقدم', 'متقن', 'محترف', 'principal'];
    const juniorKeywords = ['junior', 'مبتدئ', 'طالب', 'student', 'beginner', 'learning', 'أتعلم', 'يتعلم'];

    for (const mem of validMemories) {
      const lower = mem.factText.toLowerCase();
      if (seniorKeywords.some((kw) => lower.includes(kw))) {
        detectedDepth = 'advanced';
        depthSource = 'active_memory';
        depthReason = `User active memory [${mem.factText}] indicates advanced/expert level.`;
        break;
      }
      if (juniorKeywords.some((kw) => lower.includes(kw))) {
        detectedDepth = 'foundational';
        depthSource = 'active_memory';
        depthReason = `User active memory [${mem.factText}] indicates beginner/learning level.`;
        break;
      }
    }

    // Tier 1 vs Tier 4 vs Tier 5 for Domain Framing
    let domainFraming: string | null = null;
    let domainSource: PersonalizationSignalSource = 'default_baseline';
    let domainReason = 'No domain framing applied.';
    const domainSuppressed: Array<{ source: PersonalizationSignalSource; value: string; reason: string }> = [];

    // Tier 1: Query explicitly asks about a specific technology
    if (querySpecificTech) {
      domainFraming = querySpecificTech;
      domainSource = 'current_intent';
      domainReason = `Current user intent explicitly targeted ${querySpecificTech}.`;

      // Any memory pointing to another technology is suppressed
      for (const mem of validMemories) {
        domainSuppressed.push({
          source: 'active_memory',
          value: mem.factText,
          reason: `Suppressed in favor of current intent specifically querying ${querySpecificTech}.`,
        });
      }
    } else {
      // Check Tier 4: Temporary context in recent messages
      let temporaryTech: string | null = null;
      if (recentContext && recentContext.length > 0) {
        const lastUserTurn = recentContext.slice(-2).find((m) => m.role === 'user');
        if (lastUserTurn) {
          temporaryTech = this.detectExplicitTech(lastUserTurn.content.toLowerCase());
        }
      }

      if (temporaryTech) {
        domainFraming = temporaryTech;
        domainSource = 'current_context';
        domainReason = `Framing informed by recent conversation context referencing ${temporaryTech}.`;
      } else {
        // Tier 5: Stable active memory
        for (const mem of validMemories) {
          const lower = mem.factText.toLowerCase();
          for (const [techKey, keywords] of Object.entries(PersonalizationEngine.KNOWN_TECH_KEYWORDS)) {
            if (keywords.some((kw) => lower.includes(kw))) {
              domainFraming = techKey;
              domainSource = 'active_memory';
              domainReason = `Framing derived from active user technical profile [${mem.factText}].`;
              break;
            }
          }
          if (domainFraming) break;
        }
      }
    }

    return {
      technicalDepth: detectedDepth,
      domainFraming,
      depthDecision: {
        dimension: 'technical_depth',
        appliedValue: detectedDepth,
        source: depthSource,
        reason: depthReason,
        suppressedSignals: [],
      },
      domainDecision: {
        dimension: 'domain_framing',
        appliedValue: domainFraming || 'none',
        source: domainSource,
        reason: domainReason,
        suppressedSignals: domainSuppressed,
      },
    };
  }

  /**
   * Resolves code snippet policy based on runtime directive and technical status.
   */
  private resolveCodeSnippetPolicy(
    runtimeCodeDirective?: CodeSnippetPolicy,
    isTechnicalQuery?: boolean
  ): { codeSnippetPolicy: CodeSnippetPolicy; codeDecision: PersonalizationDecision } {
    if (runtimeCodeDirective) {
      return {
        codeSnippetPolicy: runtimeCodeDirective,
        codeDecision: {
          dimension: 'code_snippet',
          appliedValue: runtimeCodeDirective,
          source: 'current_instruction',
          reason: `Explicit current instruction requested code policy: ${runtimeCodeDirective}.`,
          suppressedSignals: [],
        },
      };
    }

    // Default: for technical queries, provide concise code snippets; non-technical: none.
    const defaultPolicy: CodeSnippetPolicy = isTechnicalQuery ? 'concise' : 'none';
    return {
      codeSnippetPolicy: defaultPolicy,
      codeDecision: {
        dimension: 'code_snippet',
        appliedValue: defaultPolicy,
        source: 'default_baseline',
        reason: isTechnicalQuery
          ? 'Technical query defaults to concise code snippets.'
          : 'Non-technical query requires no code snippets.',
        suppressedSignals: [],
      },
    };
  }

  /**
   * Resolves explanation style.
   */
  private resolveExplanationStyle(
    runtimeStyleDirective?: ExplanationStyle,
    isTechnicalQuery?: boolean,
    depth?: TechnicalDepth
  ): { explanationStyle: ExplanationStyle; styleDecision: PersonalizationDecision } {
    if (runtimeStyleDirective) {
      return {
        explanationStyle: runtimeStyleDirective,
        styleDecision: {
          dimension: 'explanation_style',
          appliedValue: runtimeStyleDirective,
          source: 'current_instruction',
          reason: `Explicit current instruction requested explanation style: ${runtimeStyleDirective}.`,
          suppressedSignals: [],
        },
      };
    }

    // Advanced technical users prefer direct solutions; others consultative/step-by-step
    const appliedStyle: ExplanationStyle =
      depth === 'advanced' ? 'direct' : depth === 'foundational' ? 'step_by_step' : 'consultative';

    return {
      explanationStyle: appliedStyle,
      styleDecision: {
        dimension: 'explanation_style',
        appliedValue: appliedStyle,
        source: 'default_baseline',
        reason: `Baseline explanation style calibrated for ${depth} depth.`,
        suppressedSignals: [],
      },
    };
  }

  /**
   * Resolves verbosity override with strict precedence (Current Instruction > Stored Preference).
   */
  private resolveVerbosity(
    runtimeVerbosity?: 'concise' | 'balanced' | 'comprehensive',
    storedVerbosity?: 'concise' | 'balanced' | 'comprehensive'
  ): {
    verbosityOverride?: 'concise' | 'balanced' | 'comprehensive';
    verbosityDecision?: PersonalizationDecision;
  } {
    if (runtimeVerbosity) {
      const suppressed = storedVerbosity && storedVerbosity !== runtimeVerbosity
        ? [
            {
              source: 'stored_preference' as PersonalizationSignalSource,
              value: storedVerbosity,
              reason: 'Overridden by explicit current instruction requesting a different verbosity level.',
            },
          ]
        : [];

      return {
        verbosityOverride: runtimeVerbosity,
        verbosityDecision: {
          dimension: 'verbosity',
          appliedValue: runtimeVerbosity,
          source: 'current_instruction',
          reason: `Explicit user directive in current message requested ${runtimeVerbosity} response.`,
          suppressedSignals: suppressed,
        },
      };
    }

    if (storedVerbosity && storedVerbosity !== 'balanced') {
      return {
        verbosityOverride: storedVerbosity,
        verbosityDecision: {
          dimension: 'verbosity',
          appliedValue: storedVerbosity,
          source: 'stored_preference',
          reason: `Applied stored persistent verbosity preference: ${storedVerbosity}.`,
          suppressedSignals: [],
        },
      };
    }

    return {};
  }

  /**
   * Resolves formality override with strict precedence.
   */
  private resolveFormality(
    runtimeFormality?: 'formal' | 'casual' | 'consultative',
    storedFormality?: 'formal' | 'casual' | 'consultative'
  ): {
    formalityOverride?: 'formal' | 'casual' | 'consultative';
    formalityDecision?: PersonalizationDecision;
  } {
    if (runtimeFormality) {
      const suppressed = storedFormality && storedFormality !== runtimeFormality
        ? [
            {
              source: 'stored_preference' as PersonalizationSignalSource,
              value: storedFormality,
              reason: 'Overridden by explicit current instruction requesting a different formality level.',
            },
          ]
        : [];

      return {
        formalityOverride: runtimeFormality,
        formalityDecision: {
          dimension: 'formality',
          appliedValue: runtimeFormality,
          source: 'current_instruction',
          reason: `Explicit user directive in current message requested ${runtimeFormality} tone.`,
          suppressedSignals: suppressed,
        },
      };
    }

    if (storedFormality && storedFormality !== 'consultative') {
      return {
        formalityOverride: storedFormality,
        formalityDecision: {
          dimension: 'formality',
          appliedValue: storedFormality,
          source: 'stored_preference',
          reason: `Applied stored persistent formality preference: ${storedFormality}.`,
          suppressedSignals: [],
        },
      };
    }

    return {};
  }

  /**
   * Builds explicit negative guardrails to prevent over-personalization.
   */
  private buildNegativeGuardrails(
    isTechnicalQuery: boolean,
    domainFraming: string | null,
    querySpecificTech: string | null
  ): string[] {
    const guardrails: string[] = [
      'NEVER open or pad your response with forced retrospective phrases like "بما أنك ذكرت سابقاً", "كما أعلم عنك", or "Since you told me before...".',
      'NEVER unsolicitedly drop user profile attributes, location, or profession into the conversation unless directly asked.',
      'Always follow the current message instructions above any historical preference or memory.',
    ];

    if (!isTechnicalQuery) {
      guardrails.push(
        'STRICT DOMAIN SEPARATION: The current query is non-technical. Do NOT mention, reference, or frame this answer using the user\'s programming or engineering background.'
      );
    } else if (querySpecificTech && domainFraming === querySpecificTech) {
      guardrails.push(
        `STRICT INTENT FOCUS: The user specifically asked about ${querySpecificTech}. Do NOT bring up or force examples in other technologies.`
      );
    }

    return guardrails;
  }
}
