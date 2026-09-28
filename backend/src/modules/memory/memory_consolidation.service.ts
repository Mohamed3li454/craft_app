/**
 * Memory Architecture - Memory Consolidation Service (Phase 2.6)
 *
 * Deterministically consolidates repeated observations and semantically identical
 * memories into cohesive canonical representations, preserving evidence, conversation diversity,
 * monotonic confidence, authority hierarchy, and temporal history.
 *
 * Strictly deterministic, zero-LLM, zero-embeddings, bounded complexity.
 */

import {
  ConsolidationAction,
  ConsolidationResult,
  MemoryImportance,
  TemporalState,
  normalizeFactText,
  calculateTokenSimilarity,
  calculateDynamicConfidence,
} from './types';
import { MemoryItemEntity, MemorySource } from '../../database/repositories/types';
import { SemanticContradictionService } from './semantic_contradiction.service';
import { MemorySafetyGate } from './memory_safety_gate';
import { logger } from '../../core/logger';

export interface ConsolidationCandidateInput {
  readonly id?: string;
  readonly factText: string;
  readonly category?: string;
  readonly temporalState?: TemporalState;
  readonly factKey?: string;
  readonly source?: MemorySource | string;
  readonly confidence?: number;
  readonly importance?: MemoryImportance;
  readonly validUntil?: Date | null;
  readonly metadata?: Record<string, any>;
}

export class MemoryConsolidationService {
  private static instance: MemoryConsolidationService;
  private contradictionService: SemanticContradictionService;

  public static getInstance(): MemoryConsolidationService {
    if (!MemoryConsolidationService.instance) {
      MemoryConsolidationService.instance = new MemoryConsolidationService();
    }
    return MemoryConsolidationService.instance;
  }

  constructor(contradictionService?: SemanticContradictionService) {
    this.contradictionService = contradictionService || SemanticContradictionService.getInstance();
  }

  /**
   * Evaluates whether a new candidate memory should be consolidated (reinforced/merged)
   * into an existing active memory or kept separate.
   *
   * Bounded comparison: Filters to 1-5 candidate memories matching user, category, or entity.
   */
  public evaluateConsolidation(
    candidate: ConsolidationCandidateInput,
    activeMemories: readonly MemoryItemEntity[]
  ): ConsolidationResult {
    if (!activeMemories || activeMemories.length === 0) {
      return {
        action: 'keep_separate',
        mergedMemoryIds: [],
        preservedMemoryIds: [],
        reason: 'No existing active memories to consolidate with',
        signals: ['no_active_memories'],
      };
    }

    const normText = normalizeFactText(candidate.factText);
    const candidateCategory = candidate.category || 'general';
    const candidateState: TemporalState = candidate.temporalState || 'unknown';
    const candTechs = this.contradictionService.detectTechEntities(normText);

    const isTechDomain = (cat?: string) =>
      ['profession', 'technical_context', 'skills', 'tools', 'projects'].includes(cat || '');

    // 1. Filter active memories matching category, tech domain, or factKey
    const matchingMemories = activeMemories.filter((m) => {
      // Must be active and not superseded
      if (m.status && m.status !== 'active') return false;

      // Same factKey
      if (candidate.factKey && m.factKey && candidate.factKey === m.factKey) return true;

      // Same category
      if (m.category === candidateCategory) return true;

      // Both in tech domain
      if (isTechDomain(m.category) && isTechDomain(candidateCategory)) return true;

      // Tech entity intersection
      const mTechs = this.contradictionService.detectTechEntities(m.factText);
      if (mTechs.some((t) => candTechs.includes(t))) return true;

      return false;
    });

    if (matchingMemories.length === 0) {
      return {
        action: 'keep_separate',
        mergedMemoryIds: [],
        preservedMemoryIds: [],
        reason: 'No overlapping active memories in category or technical domain',
        signals: ['disjoint_domain'],
      };
    }

    // 2. Rank candidates by relevance BEFORE slicing to top 5
    // Lightweight ranking considers:
    // - factKey exact match (+1.0)
    // - core token similarity (Arabic morphology aware)
    // - token similarity
    const sortedMemories = [...matchingMemories].sort((a, b) => {
      const normA = normalizeFactText(a.factText);
      const normB = normalizeFactText(b.factText);

      let scoreA = calculateTokenSimilarity(normA, normText) + this.calculateCoreSimilarity(normA, normText);
      let scoreB = calculateTokenSimilarity(normB, normText) + this.calculateCoreSimilarity(normB, normText);

      if (candidate.factKey && a.factKey === candidate.factKey) scoreA += 1.0;
      if (candidate.factKey && b.factKey === candidate.factKey) scoreB += 1.0;

      return scoreB - scoreA;
    });

    // Phase 2.8: Defense-in-depth safety gate evaluation on candidate
    const candidateSafety = MemorySafetyGate.getInstance().evaluate(normText, candidateCategory);
    if (!candidateSafety.allowed) {
      return {
        action: 'keep_separate',
        canonicalMemoryId: undefined,
        mergedMemoryIds: [],
        preservedMemoryIds: [],
        reason: `Candidate blocked by safety gate: ${candidateSafety.reason}`,
        signals: ['safety_gate_blocked', candidateSafety.reason],
      };
    }

    // 3. Strict bound: take top-5 best candidates for full evaluation
    const topCandidates = sortedMemories.slice(0, 5);

    let fallbackResult: ConsolidationResult | null = null;

    for (const existing of topCandidates) {
      const existingState: TemporalState = existing.temporalState || 'unknown';
      const existingText = normalizeFactText(existing.factText);

      // Phase 2.8: Defense-in-depth safety gate evaluation on existing memory
      const existingSafety = MemorySafetyGate.getInstance().evaluate(existingText, existing.category);
      if (!existingSafety.allowed) {
        continue; // Never consolidate an unsafe existing memory into canonical
      }

      // 1. Temporal Separation: Historical vs Current must NEVER be squashed
      if (
        (existingState === 'historical' && candidateState === 'current') ||
        (existingState === 'current' && candidateState === 'historical')
      ) {
        if (!fallbackResult) {
          fallbackResult = {
            action: 'preserve_history',
            canonicalMemoryId: existing.id,
            mergedMemoryIds: [],
            preservedMemoryIds: [existing.id],
            reason: 'Historical past experience must not be merged with current state to preserve timeline',
            signals: ['temporal_preservation:historical_vs_current'],
          };
        }
        continue;
      }

      // 2. Temporal Separation: Planned vs Current must NEVER be merged
      if (
        (existingState === 'planned' && candidateState === 'current') ||
        (existingState === 'current' && candidateState === 'planned')
      ) {
        if (!fallbackResult) {
          fallbackResult = {
            action: 'keep_separate',
            canonicalMemoryId: existing.id,
            mergedMemoryIds: [],
            preservedMemoryIds: [existing.id],
            reason: 'Planned future intention must not be merged with current active skill',
            signals: ['temporal_separation:planned_vs_current'],
          };
        }
        continue;
      }

      // 3. Semantic Contradiction & Evolution Check
      const relation = this.contradictionService.compareFacts(existing, candidate);

      if (relation.relation === 'contradicts') {
        if (!fallbackResult) {
          fallbackResult = {
            action: 'keep_separate',
            canonicalMemoryId: existing.id,
            mergedMemoryIds: [],
            preservedMemoryIds: [existing.id],
            reason: `Contradiction detected: ${relation.reason}`,
            signals: ['contradiction_blocks_consolidation', ...relation.signals],
          };
        }
        continue;
      }

      if (relation.relation === 'evolves') {
        if (!fallbackResult) {
          fallbackResult = {
            action: 'preserve_history',
            canonicalMemoryId: existing.id,
            mergedMemoryIds: [],
            preservedMemoryIds: [existing.id],
            reason: `Evolution detected: ${relation.reason}`,
            signals: ['evolution_preserves_history', ...relation.signals],
          };
        }
        continue;
      }

      // 3.5 Single-value slot conflict / evolution check
      if (candidate.factKey && existing.factKey && candidate.factKey === existing.factKey) {
        const slotSim = calculateTokenSimilarity(existingText, normText);
        const slotCoreMetrics = this.calculateCoreOverlap(existingText, normText);
        const isCoreSameFact = slotCoreMetrics.similarity >= 0.60 || (slotCoreMetrics.overlap >= 0.75 && slotCoreMetrics.inter >= 2);
        if (slotSim < 0.75 && !isCoreSameFact) {
          if (candidate.category === 'work' || candidate.factKey.startsWith('work.')) {
            if (!fallbackResult) {
              fallbackResult = {
                action: 'preserve_history',
                canonicalMemoryId: existing.id,
                mergedMemoryIds: [],
                preservedMemoryIds: [existing.id],
                reason: `Career evolution in slot [${candidate.factKey}] preserves timeline`,
                signals: ['evolution_preserves_history', `slot_evolution:${candidate.factKey}`],
              };
            }
          } else {
            if (!fallbackResult) {
              fallbackResult = {
                action: 'keep_separate',
                canonicalMemoryId: existing.id,
                mergedMemoryIds: [],
                preservedMemoryIds: [existing.id],
                reason: `Conflicting values for slot [${candidate.factKey}] blocks consolidation`,
                signals: ['contradiction_blocks_consolidation', `slot_conflict:${candidate.factKey}`],
              };
            }
          }
          continue;
        }
      }

      // Different technologies (e.g. Flutter vs React) must coexist as separate memories
      const existingTechs = this.contradictionService.detectTechEntities(existingText);
      const isDifferentTech =
        existingTechs.length > 0 &&
        candTechs.length > 0 &&
        existingTechs.some((t) => !candTechs.includes(t)) &&
        candTechs.some((t) => !existingTechs.includes(t));

      if (isDifferentTech) {
        if (!fallbackResult) {
          fallbackResult = {
            action: 'keep_separate',
            canonicalMemoryId: existing.id,
            mergedMemoryIds: [],
            preservedMemoryIds: [existing.id],
            reason: `Distinct technologies ([${existingTechs.join(', ')}] and [${candTechs.join(', ')}]) represent separate competencies and must remain distinct`,
            signals: ['distinct_technologies_kept_separate', ...existingTechs, ...candTechs],
          };
        }
        continue;
      }

      // 4. Positive Consolidation Cases (Merge / Reinforce)
      const tokenSim = calculateTokenSimilarity(existingText, normText);
      const coreMetrics = this.calculateCoreOverlap(existingText, normText);
      const coreSim = coreMetrics.similarity;
      const coreOverlap = coreMetrics.overlap;
      const coreInter = coreMetrics.inter;

      // Check for distinct numeric identifiers (e.g. "رقم 1" vs "رقم 2")
      const digitsExisting: string[] = existingText.match(/\b\d+\b/g) || [];
      const digitsCandidate: string[] = normText.match(/\b\d+\b/g) || [];
      const hasDistinctNumbers =
        digitsExisting.length > 0 &&
        digitsCandidate.length > 0 &&
        digitsExisting.some((d) => !digitsCandidate.includes(d));

      if (hasDistinctNumbers) {
        continue;
      }

      // sameTechEntity requires same/general category AND substantial core or token similarity
      const sameCategory =
        candidateCategory === existing.category ||
        candidateCategory === 'general' ||
        existing.category === 'general';

      const sameTechEntity =
        candTechs.length > 0 &&
        existingTechs.length > 0 &&
        candTechs.every((t) => existingTechs.includes(t)) &&
        existingTechs.every((t) => candTechs.includes(t)) &&
        existingState === candidateState &&
        sameCategory &&
        (coreSim >= 0.50 || tokenSim >= 0.60 || (coreOverlap >= 0.80 && coreInter >= 2));

      const sameFactIdentity =
        Boolean(candidate.factKey && existing.factKey && candidate.factKey === existing.factKey) &&
        existingState === candidateState &&
        (tokenSim >= 0.75 || coreSim >= 0.60 || (coreOverlap >= 0.75 && coreInter >= 2));

      const isConsolidatable =
        tokenSim >= 0.70 ||
        coreSim >= 0.70 ||
        sameTechEntity ||
        sameFactIdentity;

      if (isConsolidatable) {
        // Choose the canonical fact text: pick the more descriptive or explicit one
        const canonicalFactText =
          existingText.length >= normText.length ? existingText : normText;

        // Consolidate evidence counts and conversation diversity
        const existingCount = Number(existing.metadata?.evidenceCount || 1);
        const newCount = Number(candidate.metadata?.evidenceCount || 1);
        const totalEvidenceCount = existingCount + newCount;

        const existingConvIds: string[] = Array.isArray(existing.metadata?.conversationIds)
          ? existing.metadata.conversationIds
          : existing.metadata?.conversationId
          ? [String(existing.metadata.conversationId)]
          : [];
        const newConvIds: string[] = Array.isArray(candidate.metadata?.conversationIds)
          ? candidate.metadata.conversationIds
          : candidate.metadata?.conversationId
          ? [String(candidate.metadata.conversationId)]
          : [];
        const combinedConvIds = Array.from(new Set([...existingConvIds, ...newConvIds]));

        const existingConvCount = typeof existing.metadata?.conversationCount === 'number'
          ? existing.metadata.conversationCount
          : (existingConvIds.length > 0 ? existingConvIds.length : 0);
        const candidateConvCount = typeof candidate.metadata?.conversationCount === 'number'
          ? candidate.metadata.conversationCount
          : (newConvIds.length > 0 ? newConvIds.length : 0);

        const newlyAdded = newConvIds.filter((id) => id && !existingConvIds.includes(id));
        const combinedConvCount = (existingConvCount === 0 && candidateConvCount === 0 && combinedConvIds.length === 0)
          ? 0
          : Math.max(combinedConvIds.length, existingConvCount + newlyAdded.length, candidateConvCount);

        const existingSources: string[] = Array.isArray(existing.metadata?.sources)
          ? existing.metadata.sources
          : [existing.source || 'automatic_extraction'];
        const newSources: string[] = Array.isArray(candidate.metadata?.sources)
          ? candidate.metadata.sources
          : [candidate.source || 'automatic_extraction'];
        const combinedSources = Array.from(new Set([...existingSources, ...newSources])) as MemorySource[];

        const hasExplicit =
          combinedSources.includes('user_explicit') ||
          combinedSources.includes('agent_tool') ||
          Boolean(existing.metadata?.isExplicit || candidate.metadata?.isExplicit);

        // Consolidated dynamic confidence (monotonic with diminishing returns)
        const calcDynamicConf = calculateDynamicConfidence({
          evidenceCount: totalEvidenceCount,
          conversationCount: combinedConvCount,
          sources: combinedSources,
          isExplicit: hasExplicit,
          category: candidateCategory,
        });

        const consolidatedConfidence = Math.max(
          existing.confidence ?? 0.7,
          candidate.confidence ?? 0.7,
          calcDynamicConf
        );

        // Consolidated importance
        const consolidatedImportance = this.consolidateImportance(
          existing.importance,
          candidate.importance
        );

        return {
          action: 'reinforce',
          canonicalMemoryId: existing.id,
          mergedMemoryIds: candidate.id ? [candidate.id] : [],
          preservedMemoryIds: [existing.id],
          reason: `Consolidating repeated evidence for canonical fact: [${canonicalFactText}] (${totalEvidenceCount} observations across ${combinedConvCount} conversations)`,
          signals: ['same_canonical_fact_reinforced', ...(sameTechEntity ? candTechs : [])],
          consolidatedFactText: canonicalFactText,
          consolidatedConfidence,
          consolidatedImportance,
        };
      }
    }

    if (fallbackResult) {
      return fallbackResult;
    }

    return {
      action: 'keep_separate',
      mergedMemoryIds: [],
      preservedMemoryIds: [],
      reason: 'Facts represent distinct aspects and are kept separate',
      signals: ['safe_separation_default'],
    };
  }

  /**
   * Extracts essential semantic tokens by stripping boilerplate prefixes,
   * common Arabic stop words, and morphological affixes.
   */
  public extractCoreTokens(text: string): Set<string> {
    const boilerplate = new Set([
      'المستخدم', 'مستخدم', 'user', 'تقنية', 'تقنيه', 'اداة', 'اداه',
      'اطار', 'اطار_عمل', 'حزمة', 'حزمه', 'مكتبة', 'مكتبه', 'لغة', 'لغه', 'language',
      'في', 'من', 'على', 'الي', 'الى', 'مع', 'عن', 'حتى', 'هو', 'هي', 'بتاع', 'خاص',
      'يعمل', 'شغال', 'بيشتغل', 'اشتغل'
    ]);

    const clean = text
      .toLowerCase()
      .replace(/[أإآٱ]/g, 'ا')
      .replace(/ة/g, 'ه')
      .replace(/ى/g, 'ي')
      .replace(/[^\w\s\u0600-\u06FF]/g, ' ');

    const words = clean.split(/\s+/).filter(Boolean);
    const result = new Set<string>();

    for (let w of words) {
      if (boilerplate.has(w)) continue;
      if (w.startsWith('ال') && w.length > 4) {
        w = w.slice(2);
      }
      if ((w.startsWith('ل') || w.startsWith('ب') || w.startsWith('و') || w.startsWith('ك')) && w.length > 4) {
        w = w.slice(1);
      }
      if (!boilerplate.has(w) && w.length > 1) {
        result.add(w);
      }
    }
    return result;
  }

  /**
   * Computes overlap metrics across core semantic tokens.
   */
  public calculateCoreOverlap(a: string, b: string): { similarity: number; overlap: number; inter: number } {
    const setA = this.extractCoreTokens(a);
    const setB = this.extractCoreTokens(b);
    if (setA.size === 0 || setB.size === 0) return { similarity: 0, overlap: 0, inter: 0 };
    let inter = 0;
    for (const t of setA) {
      if (setB.has(t)) inter++;
    }
    const union = setA.size + setB.size - inter;
    const minSize = Math.min(setA.size, setB.size);
    return {
      similarity: union > 0 ? inter / union : 0,
      overlap: minSize > 0 ? inter / minSize : 0,
      inter,
    };
  }

  /**
   * Computes Jaccard similarity across core semantic tokens.
   */
  public calculateCoreSimilarity(a: string, b: string): number {
    return this.calculateCoreOverlap(a, b).similarity;
  }

  /**
   * Consolidates importance deterministically:
   * high + normal -> high
   * critical + high -> critical
   * normal + low -> normal
   */
  public consolidateImportance(
    impA?: MemoryImportance,
    impB?: MemoryImportance
  ): MemoryImportance {
    const a = impA || 'normal';
    const b = impB || 'normal';

    if (a === 'critical' || b === 'critical') return 'critical';
    if (a === 'high' || b === 'high') return 'high';
    if (a === 'normal' || b === 'normal') return 'normal';
    return 'low';
  }
}
