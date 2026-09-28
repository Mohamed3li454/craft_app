/**
 * Memory Architecture - Semantic Contradiction & Memory Evolution Service (Phase 2.5)
 *
 * Deterministically analyzes semantic relationships between new candidate facts and existing memories.
 * Distinguishes direct contradiction, temporal evolution, cessation/negation, and peaceful coexistence.
 *
 * Strictly deterministic, zero-LLM, zero-embeddings, bounded complexity.
 */

import {
  MemoryRelation,
  SemanticRelationResult,
  normalizeFactText,
  calculateTokenSimilarity,
} from './types';
import { MemoryItemEntity, TemporalState } from '../../database/repositories/types';
import { logger } from '../../core/logger';

// Standard technical entities to recognize
const KNOWN_TECH_ENTITIES = [
  { id: 'flutter', names: ['flutter', 'فلاتر'] },
  { id: 'dart', names: ['dart', 'دارت'] },
  { id: 'react', names: ['react', 'رياكت'] },
  { id: 'rust', names: ['rust', 'رست'] },
  { id: 'supabase', names: ['supabase', 'سوبابيز'] },
  { id: 'python', names: ['python', 'بايثون'] },
  { id: 'docker', names: ['docker', 'دوكر'] },
  { id: 'typescript', names: ['typescript', 'تايب سكريبت'] },
  { id: 'javascript', names: ['javascript', 'جافا سكريبت'] },
  { id: 'nodejs', names: ['nodejs', 'node', 'نود'] },
  { id: 'angular', names: ['angular', 'أنجولار', 'انجولار'] },
  { id: 'vue', names: ['vue', 'فيو'] },
];

// Cessation / discontinuation phrases indicating evolution to historical
const CESSATION_PATTERNS: RegExp[] = [
  /(?:^|\s)لم\s+أعد\s+(?:أستخدم|استخدم|أعمل|اعمل|شغال|بشتغل)/i,
  /(?:^|\s)لم\s+اعد\s+(?:أستخدم|استخدم|أعمل|اعمل|شغال|بشتغل)/i,
  /(?:^|\s)بطلت\s+(?:أستخدم|استخدم|أشتغل|اشتغل|أعمل|اعمل)/i,
  /(?:^|\s)مش\s+شغال\s+(?:على|مع|بـ|في)/i,
  /(?:^|\s)مش\s+بستخدم/i,
  /(?:^|\s)(?:سبت|سيبت|تركت)\s+/i,
  /\bno\s+longer\s+use\b/i,
  /\bno\s+longer\s+work\b/i,
  /\bstopped\s+using\b/i,
  /\bstopped\s+working\b/i,
  /\bdon['’]?t\s+use\s+.+\s+anymore\b/i,
];

// Total denial phrases indicating the previous memory was factually invalid (contradiction)
const TOTAL_DENIAL_PATTERNS: RegExp[] = [
  /(?:^|\s)عمري\s+ما\s+(?:استخدمت|اشتغلت|كنت)/i,
  /(?:^|\s)ما\s+استخدمتش/i,
  /(?:^|\s)لم\s+يسبق\s+لي\s+استخدام/i,
  /\bnever\s+used\b/i,
  /\bnever\s+worked\s+with\b/i,
  /\bnever\s+been\b/i,
];

// Workplace / company transition phrases
const WORKPLACE_TRANSITION_PATTERNS: RegExp[] = [
  /(?:تركت|سيبت|سبت|ترك)\s+(.+?)\s+(?:و|وإني|وبقيت|وأعمل|وعملت|ودلوقتي|وبدأت|وبدأ)\s+(?:في|شغال\s+في|أعمل\s+في|العمل\s+في|مع)\s+(.+)/i,
  /(?:نقلت\s+من|اتنقلت\s+من|انتقل\s+من)\s+(.+?)\s+(?:إلى|الى|لـ|ل)\s+(.+)/i,
  /\b(?:left|quit)\s+(.+?)\s+and\s+(?:now\s+work\s+at|joined|started\s+at)\s+(.+)/i,
  /\bswitched\s+from\s+(.+?)\s+to\s+(.+)/i,
];

export interface CandidateFactInput {
  readonly id?: string;
  readonly factText: string;
  readonly category?: string;
  readonly temporalState?: TemporalState;
  readonly factKey?: string;
  readonly source?: string;
  readonly validUntil?: Date | null;
}

export class SemanticContradictionService {
  private static instance: SemanticContradictionService;

  public static getInstance(): SemanticContradictionService {
    if (!SemanticContradictionService.instance) {
      SemanticContradictionService.instance = new SemanticContradictionService();
    }
    return SemanticContradictionService.instance;
  }

  /**
   * Evaluates a candidate memory fact against a collection of existing active memories.
   * Finds the most salient relation and determines if any destructive or evolution mutation is warranted.
   */
  public evaluateRelationAgainstActive(
    candidate: CandidateFactInput,
    activeMemories: readonly MemoryItemEntity[]
  ): SemanticRelationResult {
    if (!activeMemories || activeMemories.length === 0) {
      return {
        relation: 'unrelated',
        confidence: 1.0,
        reason: 'No existing active memories to compare against',
        signals: ['no_active_memories'],
        suggestedAction: 'keep_both',
      };
    }

    const normCandidateText = normalizeFactText(candidate.factText);
    const candidateCategory = candidate.category || 'general';

    // Filter relevant active memories to bound computational complexity
    const relevantMemories = activeMemories.filter((m) => {
      // 1. Same factKey
      if (candidate.factKey && m.factKey && candidate.factKey === m.factKey) {
        return true;
      }
      // 2. Same category
      if (m.category === candidateCategory) {
        return true;
      }
      // 3. Technical entities overlap
      const mTech = this.detectTechEntities(m.factText);
      const candTech = this.detectTechEntities(normCandidateText);
      if (mTech.some((t) => candTech.includes(t))) {
        return true;
      }
      // 4. Identity overlap
      if (
        (candidateCategory === 'identity' || m.category === 'identity') &&
        (m.factText.includes('اسمي') || normCandidateText.includes('اسمي') ||
         m.factText.includes('اسم المستخدم') || normCandidateText.includes('اسم المستخدم'))
      ) {
        return true;
      }
      return false;
    });

    if (relevantMemories.length === 0) {
      return {
        relation: 'unrelated',
        confidence: 1.0,
        reason: 'Candidate fact has no domain or entity overlap with active memories',
        signals: ['disjoint_scope'],
        suggestedAction: 'keep_both',
      };
    }

    // Evaluate candidate against relevant memories
    // Priority order of relations: contradicts > evolves > supports > coexists > uncertain
    let bestResult: SemanticRelationResult = {
      relation: 'unrelated',
      confidence: 1.0,
      reason: 'No meaningful interaction detected',
      signals: [],
      suggestedAction: 'keep_both',
    };

    for (const existing of relevantMemories) {
      const result = this.compareFacts(existing, candidate);

      if (result.relation === 'contradicts') {
        return result; // Contradiction has highest precedence
      }
      if (result.relation === 'evolves') {
        bestResult = result; // Evolves takes precedence over coexists/supports
      } else if (result.relation === 'supports' && bestResult.relation !== 'evolves') {
        bestResult = result;
      } else if (result.relation === 'coexists' && bestResult.relation === 'unrelated') {
        bestResult = result;
      } else if (result.relation === 'uncertain' && bestResult.relation === 'unrelated') {
        bestResult = result;
      }
    }

    return bestResult;
  }

  /**
   * Deterministically compares two individual facts:
   * @param factA The existing / baseline fact
   * @param factB The new / candidate fact
   */
  public compareFacts(
    factA: CandidateFactInput,
    factB: CandidateFactInput
  ): SemanticRelationResult {
    const textA = normalizeFactText(factA.factText);
    const textB = normalizeFactText(factB.factText);
    const lowerA = textA.toLowerCase();
    const lowerB = textB.toLowerCase();

    const catA = factA.category || 'general';
    const catB = factB.category || 'general';

    const stateA = factA.temporalState || 'unknown';
    const stateB = factB.temporalState || 'unknown';

    // 1. Exact or near-identical text (Support / Deduplication)
    const tokenSim = calculateTokenSimilarity(textA, textB);
    if (tokenSim >= 0.85) {
      return {
        relation: 'supports',
        confidence: 0.95,
        reason: `High lexical similarity (${Math.round(tokenSim * 100)}%) corroborates existing memory`,
        signals: ['token_similarity_support'],
        targetMemoryId: factA.id,
        suggestedAction: 'no_op',
      };
    }

    // 2. Single-Value Identity Slot: User Name
    const isIdentityA = catA === 'identity' || factA.factKey === 'identity.name' || textA.includes('اسم المستخدم:');
    const isIdentityB = catB === 'identity' || factB.factKey === 'identity.name' || textB.includes('اسم المستخدم:');

    if (isIdentityA && isIdentityB) {
      const nameA = this.extractIdentityName(textA);
      const nameB = this.extractIdentityName(textB);

      if (nameA && nameB) {
        if (nameA.toLowerCase() === nameB.toLowerCase()) {
          return {
            relation: 'supports',
            confidence: 0.98,
            reason: `User name matches existing identity [${nameA}]`,
            signals: ['identity_name_match'],
            targetMemoryId: factA.id,
            suggestedAction: 'no_op',
          };
        } else {
          return {
            relation: 'contradicts',
            confidence: 0.98,
            reason: `Direct contradiction in single-value identity slot: existing [${nameA}] vs new [${nameB}]`,
            signals: ['slot_value_conflict:identity.name', nameA, nameB],
            targetMemoryId: factA.id,
            suggestedAction: 'supersede_target',
          };
        }
      }
    }

    // 3. Single-Value Preference: UI Theme (Dark vs Light)
    const isThemeA = factA.factKey === 'preference.theme' || lowerA.includes('dark mode') || lowerA.includes('light mode') || textA.includes('الوضع الليلي') || textA.includes('الوضع الفاتح');
    const isThemeB = factB.factKey === 'preference.theme' || lowerB.includes('dark mode') || lowerB.includes('light mode') || textB.includes('الوضع الليلي') || textB.includes('الوضع الفاتح');

    if (isThemeA && isThemeB) {
      const isDarkA = lowerA.includes('dark') || textA.includes('الليلي');
      const isDarkB = lowerB.includes('dark') || textB.includes('الليلي');
      if (isDarkA !== isDarkB) {
        return {
          relation: 'contradicts',
          confidence: 0.95,
          reason: 'Direct contradiction in single-value theme preference (Dark vs Light)',
          signals: ['theme_preference_switch'],
          targetMemoryId: factA.id,
          suggestedAction: 'supersede_target',
        };
      } else {
        return {
          relation: 'supports',
          confidence: 0.95,
          reason: 'Theme preference matches existing setting',
          signals: ['theme_preference_reaffirmed'],
          targetMemoryId: factA.id,
          suggestedAction: 'no_op',
        };
      }
    }

    // 4. Explicit Denial (Total Denial -> Contradiction)
    const isTotalDenial = TOTAL_DENIAL_PATTERNS.some((p) => p.test(textB));
    if (isTotalDenial) {
      const techEntitiesA = this.detectTechEntities(textA);
      const techEntitiesB = this.detectTechEntities(textB);
      const sharedTech = techEntitiesA.filter((t) => techEntitiesB.includes(t));

      if (sharedTech.length > 0) {
        return {
          relation: 'contradicts',
          confidence: 0.95,
          reason: `Explicit denial of fact indicates previous memory regarding [${sharedTech.join(', ')}] was invalid`,
          signals: ['explicit_total_denial', ...sharedTech],
          targetMemoryId: factA.id,
          suggestedAction: 'supersede_target',
        };
      }
    }

    // 5. Explicit Cessation / Discontinuation (Evolution -> evolve_target_to_historical)
    const isCessation = CESSATION_PATTERNS.some((p) => p.test(textB));
    if (isCessation) {
      const techEntitiesA = this.detectTechEntities(textA);
      const techEntitiesB = this.detectTechEntities(textB);
      const sharedTech = techEntitiesA.filter((t) => techEntitiesB.includes(t));

      if (sharedTech.length > 0 && stateA !== 'historical') {
        return {
          relation: 'evolves',
          confidence: 0.95,
          reason: `Explicit cessation statement indicates skill [${sharedTech.join(', ')}] has transitioned from current to historical`,
          signals: ['explicit_cessation_evolution', ...sharedTech],
          targetMemoryId: factA.id,
          suggestedAction: 'evolve_target_to_historical',
        };
      }
    }

    // 6. Workplace / Employment Transition Evolution
    const workplaceMatch = this.detectWorkplaceTransition(textB);
    if (workplaceMatch) {
      const { oldCompany, newCompany } = workplaceMatch;
      if (lowerA.includes(oldCompany.toLowerCase()) || textA.includes(oldCompany)) {
        return {
          relation: 'evolves',
          confidence: 0.95,
          reason: `Workplace transition from [${oldCompany}] to [${newCompany}] signals professional career evolution`,
          signals: ['workplace_transition', oldCompany, newCompany],
          targetMemoryId: factA.id,
          suggestedAction: 'evolve_target_to_historical',
        };
      }
    }

    // 7. Temporal Coexistence: Historical vs Current
    if (stateA === 'historical' && stateB === 'current') {
      return {
        relation: 'coexists',
        confidence: 0.95,
        reason: 'Historical past experience peacefully coexists with current state',
        signals: ['temporal_coexistence:historical_vs_current'],
        targetMemoryId: factA.id,
        suggestedAction: 'keep_both',
      };
    }

    // 8. Temporal Coexistence: Planned vs Current
    if (
      (stateA === 'planned' && stateB === 'current') ||
      (stateA === 'current' && stateB === 'planned')
    ) {
      return {
        relation: 'coexists',
        confidence: 0.95,
        reason: 'Future planned goal peacefully coexists with current state',
        signals: ['temporal_coexistence:planned_vs_current'],
        targetMemoryId: factA.id,
        suggestedAction: 'keep_both',
      };
    }

    // 9. Technical Context Coexistence (Multi-skill / Multi-tool)
    const techA = this.detectTechEntities(textA);
    const techB = this.detectTechEntities(textB);

    if (techA.length > 0 && techB.length > 0) {
      const distinctTech = techA.some((t) => !techB.includes(t)) || techB.some((t) => !techA.includes(t));
      if (distinctTech) {
        // Different technologies peacefully coexist without contradiction!
        return {
          relation: 'coexists',
          confidence: 0.95,
          reason: `Different technologies ([${techA.join(', ')}] and [${techB.join(', ')}]) peacefully coexist in technical context`,
          signals: ['multi_skill_coexistence', ...techA, ...techB],
          targetMemoryId: factA.id,
          suggestedAction: 'keep_both',
        };
      }
    }

    // 10. Disjoint domains / categories
    if (catA !== catB && catA !== 'general' && catB !== 'general') {
      return {
        relation: 'unrelated',
        confidence: 1.0,
        reason: `Distinct domains [${catA}] and [${catB}] have no semantic interaction`,
        signals: ['disjoint_domains'],
        targetMemoryId: factA.id,
        suggestedAction: 'keep_both',
      };
    }

    // 11. Uncertain: Linguistically different facts without deterministic rule
    // Never make speculative assumptions; safely default to coexistence
    return {
      relation: 'uncertain',
      confidence: 0.50,
      reason: 'No deterministic contradiction or evolution rule matches; defaulting to safe coexistence',
      signals: ['uncertain_relation'],
      targetMemoryId: factA.id,
      suggestedAction: 'keep_both',
    };
  }

  /**
   * Helper: Detects known technical entities in a text string.
   */
  public detectTechEntities(text: string): string[] {
    const lower = text.toLowerCase();
    const detected: string[] = [];

    for (const tech of KNOWN_TECH_ENTITIES) {
      if (tech.names.some((n) => lower.includes(n))) {
        detected.push(tech.id);
      }
    }

    return detected;
  }

  /**
   * Helper: Extracts user name from an identity string.
   */
  private extractIdentityName(text: string): string | undefined {
    const clean = normalizeFactText(text);

    const prefixMatch = clean.match(/(?:اسم المستخدم|اسمي|أنا اسمي)\s*:\s*([^\s,،.]+)/i);
    if (prefixMatch && prefixMatch[1]) {
      return prefixMatch[1].trim();
    }

    const naturalMatch = clean.match(/(?:اسمي|أنا اسمي)\s+([^\s,،.]+)/i);
    if (naturalMatch && naturalMatch[1]) {
      return naturalMatch[1].trim();
    }

    return undefined;
  }

  /**
   * Helper: Detects company/workplace transition expressions.
   */
  private detectWorkplaceTransition(text: string): { oldCompany: string; newCompany: string } | null {
    for (const pattern of WORKPLACE_TRANSITION_PATTERNS) {
      const match = text.match(pattern);
      if (match && match[1] && match[2]) {
        const oldCompany = match[1].replace(/^(?:شركة|شركة\s+)/i, '').trim();
        const newCompany = match[2].replace(/^(?:شركة|شركة\s+)/i, '').trim();
        if (oldCompany.length >= 2 && newCompany.length >= 2) {
          return { oldCompany, newCompany };
        }
      }
    }
    return null;
  }
}
