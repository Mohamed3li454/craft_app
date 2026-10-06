/**
 * Global Context Deduplicator (Phase 14.5)
 *
 * Implements deterministic, cross-source context deduplication:
 * 1. Exact Duplicate Elimination:
 *    - Strips identical content instances across and within subsystems.
 * 2. Structural & Semantic Redundancy Resolution:
 *    - Reconciles overlapping representations (e.g. Memory preference vs Personalization directive).
 *    - Preserves authoritative representation according to SOURCE_AUTHORITY_MAP.
 * 3. Invariant Guarantees:
 *    - NEVER deduplicates away the Current User Message.
 *    - NEVER collapses distinct facts (e.g., "likes Flutter" vs "building Flutter app" vs "debugging Flutter").
 *    - Contradiction is NOT duplication: conflicting preferences are preserved for authoritative precedence.
 *    - Tool observations beat historical assumptions or memory.
 *    - Fresh search evidence vs user-stated history are distinct and preserved.
 * 4. Zero LLM Cost & Zero Latency Overhead:
 *    - 100% deterministic local hash, canonical key, and pattern matching.
 */

import crypto from 'crypto';
import {
  ContextItem,
  ContextSourceType,
  ContextPriority,
  ContextDeduplicationProvenance,
  DeduplicationResult,
  ContextBudgetMode,
  SOURCE_AUTHORITY_MAP,
} from './context_deduplicator.types';
import { TokenCounter } from './token_counter';
import { PersonalizationPolicy } from '../personalization/types';

export interface DeduplicationOptions {
  readonly budgetMode?: ContextBudgetMode;
  readonly preserveCurrentMessage?: boolean;
}

export class GlobalContextDeduplicator {
  /**
   * Deterministic SHA-256 fingerprint for a context item.
   */
  public static computeFingerprint(
    source: ContextSourceType,
    content: string,
    identityKey?: string
  ): string {
    const norm = this.normalizeSemanticContent(content);
    const key = (identityKey || 'generic').toLowerCase().trim();
    return crypto
      .createHash('sha256')
      .update(`${source}:::${key}:::${norm}`, 'utf8')
      .digest('hex')
      .substring(0, 16);
  }

  /**
   * Normalizes content text for semantic comparison without loss of meaning.
   */
  public static normalizeSemanticContent(text: string): string {
    if (!text || typeof text !== 'string') return '';

    return text
      .trim()
      .toLowerCase()
      // Collapse whitespace
      .replace(/\s+/g, ' ')
      // Normalize Arabic diacritics
      .replace(/[\u064B-\u065F\u0670]/g, '')
      // Normalize Alefs
      .replace(/[أإآ]/g, 'ا')
      // Normalize Taa Marbuta
      .replace(/ة/g, 'ه')
      // Normalize Yaa / Alef Maksura
      .replace(/ى/g, 'ي')
      // Strip outer punctuation
      .replace(/^[\s.,:;!?؟]+|[\s.,:;!?؟]+$/g, '');
  }

  /**
   * Factory to construct a normalized ContextItem.
   */
  public static createContextItem(
    source: ContextSourceType,
    content: string,
    identityKey: string,
    priority: ContextPriority = 'MEDIUM',
    relevance: number = 0.8,
    metadata?: Record<string, any>,
    dependencies?: readonly string[]
  ): ContextItem {
    const id = this.computeFingerprint(source, content, identityKey);
    const authority = SOURCE_AUTHORITY_MAP[source] || 10;

    return {
      id,
      source,
      content,
      priority,
      authority,
      relevance,
      identityKey: identityKey.toLowerCase().trim(),
      metadata,
      dependencies,
    };
  }

  /**
   * Executes global context deduplication across all context items.
   */
  public static deduplicate(
    items: readonly ContextItem[],
    options?: DeduplicationOptions
  ): DeduplicationResult {
    if (!items || items.length === 0) {
      return {
        preservedItems: [],
        removedItems: [],
        provenances: [],
        totalTokensBefore: 0,
        totalTokensAfter: 0,
        tokensSaved: 0,
        budgetMode: options?.budgetMode || 'STANDARD',
      };
    }

    const budgetMode = options?.budgetMode || 'STANDARD';
    const totalTokensBefore = items.reduce((sum, item) => sum + TokenCounter.countTokens(item.content), 0);

    const preserved: ContextItem[] = [];
    const removed: ContextItem[] = [];
    const provenances: ContextDeduplicationProvenance[] = [];

    // Group items by semantic identity key
    const exactSeenFingerprints = new Set<string>();
    const identityKeyGroups = new Map<string, ContextItem[]>();

    // Step 1: Exact Duplicate Filter within and across sources
    for (const item of items) {
      // Invariant: CURRENT_MESSAGE is NEVER deduplicated away (Section 6)
      if (item.source === 'CURRENT_MESSAGE') {
        preserved.push(item);
        continue;
      }

      // Check exact duplicate by fingerprint
      if (exactSeenFingerprints.has(item.id)) {
        removed.push(item);
        provenances.push({
          canonicalSource: item.source,
          canonicalId: item.id,
          originalSources: [item.source],
          deduplicatedIds: [item.id],
          reason: 'EXACT_DUPLICATE_FINGERPRINT',
          tokensSaved: TokenCounter.countTokens(item.content),
        });
        continue;
      }
      exactSeenFingerprints.add(item.id);

      // Group by identity key for structural cross-source deduplication
      const groupKey = item.identityKey || `item_${item.id}`;
      if (!identityKeyGroups.has(groupKey)) {
        identityKeyGroups.set(groupKey, []);
      }
      identityKeyGroups.get(groupKey)!.push(item);
    }

    // Step 2: Structural & Cross-Source Redundancy Resolution per Group
    for (const [key, groupItems] of Array.from(identityKeyGroups.entries())) {
      if (groupItems.length === 1) {
        preserved.push(groupItems[0]);
        continue;
      }

      // Group has multiple items sharing an identity key.
      // We must distinguish between:
      // A) True structural duplicates (e.g. Memory says "User prefers Flutter" and Personalization says "Preferred: Flutter")
      // B) Distinct facts (e.g. "likes Flutter" vs "building Flutter app" vs "debugging Flutter performance") -> MUST PRESERVE ALL!
      // C) Contradiction (e.g. "prefers English" vs "كلمني بالمصري") -> NOT a duplicate! Must preserve conflict for precedence.

      const resolvedGroup = this.resolveGroupRedundancy(groupItems);
      for (const p of resolvedGroup.preserved) {
        preserved.push(p);
      }
      for (const r of resolvedGroup.removed) {
        removed.push(r);
      }
      for (const prov of resolvedGroup.provenances) {
        provenances.push(prov);
      }
    }

    // Sort preserved items by priority and authority
    preserved.sort((a, b) => {
      // Current message always last or first depending on role; authority orders priority
      if (a.source === 'CURRENT_MESSAGE') return 1;
      if (b.source === 'CURRENT_MESSAGE') return -1;
      return a.authority - b.authority;
    });

    const totalTokensAfter = preserved.reduce((sum, item) => sum + TokenCounter.countTokens(item.content), 0);
    const tokensSaved = Math.max(0, totalTokensBefore - totalTokensAfter);

    return {
      preservedItems: preserved,
      removedItems: removed,
      provenances,
      totalTokensBefore,
      totalTokensAfter,
      tokensSaved,
      budgetMode,
    };
  }

  /**
   * Resolves structural redundancy within an identity group while protecting distinct facts and contradictions.
   */
  private static resolveGroupRedundancy(items: ContextItem[]): {
    preserved: ContextItem[];
    removed: ContextItem[];
    provenances: ContextDeduplicationProvenance[];
  } {
    const preserved: ContextItem[] = [];
    const removed: ContextItem[] = [];
    const provenances: ContextDeduplicationProvenance[] = [];

    // Sort items in group by authority (lowest number = highest authority)
    const sorted = [...items].sort((a, b) => a.authority - b.authority);

    for (let i = 0; i < sorted.length; i++) {
      const current = sorted[i];

      // Check if current is structurally redundant with any already preserved item in this group
      let isRedundant = false;
      let canonicalMatch: ContextItem | null = null;

      for (const cand of preserved) {
        if (this.isStructuralDuplicate(cand, current)) {
          isRedundant = true;
          canonicalMatch = cand;
          break;
        }
      }

      if (isRedundant && canonicalMatch) {
        removed.push(current);
        provenances.push({
          canonicalSource: canonicalMatch.source,
          canonicalId: canonicalMatch.id,
          originalSources: [canonicalMatch.source, current.source],
          deduplicatedIds: [current.id],
          reason: `STRUCTURAL_DUPLICATE_SUPERSEDED_BY_${canonicalMatch.source}`,
          tokensSaved: TokenCounter.countTokens(current.content),
        });
      } else {
        preserved.push(current);
      }
    }

    return { preserved, removed, provenances };
  }

  /**
   * Determines if itemB is a structural duplicate of itemA that adds zero new information.
   * STRICT INVARIANT: If both items contain distinct details or represent a contradiction, returns FALSE!
   */
  public static isStructuralDuplicate(itemA: ContextItem, itemB: ContextItem): boolean {
    // 1. Invariant: CURRENT_MESSAGE is NEVER a duplicate of anything (Section 6)
    if (itemA.source === 'CURRENT_MESSAGE' || itemB.source === 'CURRENT_MESSAGE') {
      return false;
    }

    // 2. Invariant: Contradiction is NOT duplication (Section 19, 45)
    if (this.isContradiction(itemA, itemB)) {
      return false;
    }

    // 3. Invariant: User history vs fresh search evidence are NOT duplicates (Section 11, 46)
    if (
      (itemA.source === 'CONVERSATION' && itemB.source === 'SEARCH_EVIDENCE') ||
      (itemA.source === 'SEARCH_EVIDENCE' && itemB.source === 'CONVERSATION')
    ) {
      return false;
    }

    // 4. Invariant: Distinct facts must never be collapsed (Section 18, 44)
    if (this.areDistinctFacts(itemA.content, itemB.content)) {
      return false;
    }

    // 5. Cross-Source Structural Duplicates:
    // Case 5.1: Memory vs Personalization (Section 9)
    if (
      (itemA.source === 'PERSONALIZATION' && itemB.source === 'MEMORY') ||
      (itemA.source === 'MEMORY' && itemB.source === 'PERSONALIZATION')
    ) {
      const normA = this.normalizeSemanticContent(itemA.content);
      const normB = this.normalizeSemanticContent(itemB.content);
      return this.sharesSubstantiveCore(normA, normB);
    }

    // Case 5.2: Memory vs History (Section 8)
    if (
      (itemA.source === 'MEMORY' && itemB.source === 'CONVERSATION') ||
      (itemA.source === 'CONVERSATION' && itemB.source === 'MEMORY')
    ) {
      const normA = this.normalizeSemanticContent(itemA.content);
      const normB = this.normalizeSemanticContent(itemB.content);
      // Only redundant if both are simple statements of preference with identical substantive core
      return this.sharesSubstantiveCore(normA, normB);
    }

    // Case 5.3: Tool Observation vs Search Evidence (Section 10)
    if (
      (itemA.source === 'VERIFIED_TOOL_OBSERVATION' && itemB.source === 'SEARCH_EVIDENCE') ||
      (itemA.source === 'SEARCH_EVIDENCE' && itemB.source === 'VERIFIED_TOOL_OBSERVATION')
    ) {
      const normA = this.normalizeSemanticContent(itemA.content);
      const normB = this.normalizeSemanticContent(itemB.content);
      return normA.includes(normB) || normB.includes(normA);
    }

    // Exact semantic equivalence
    const normA = this.normalizeSemanticContent(itemA.content);
    const normB = this.normalizeSemanticContent(itemB.content);
    return normA === normB;
  }

  /**
   * Tests whether two contents represent distinct facts rather than redundant statements.
   * e.g., "User likes Flutter" vs "User is building a Flutter app" vs "User is debugging Flutter"
   */
  public static areDistinctFacts(textA: string, textB: string): boolean {
    const normA = this.normalizeSemanticContent(textA);
    const normB = this.normalizeSemanticContent(textB);

    if (normA === normB) return false;

    // Distinct activity or state markers
    const activityMarkers = [
      'building', 'debugging', 'testing', 'installing', 'deployed', 'migrating',
      'ببني', 'شغال على', 'بعمل', 'بصلح', 'مشروع', 'عندي مشكلة', 'نسخة', 'version'
    ];

    const aHasActivity = activityMarkers.some((m) => normA.includes(m));
    const bHasActivity = activityMarkers.some((m) => normA.includes(m) !== normB.includes(m));

    if (aHasActivity || bHasActivity) {
      // If one states an active engineering task and the other states general preference, they are distinct!
      return true;
    }

    // If word count or length differs substantially (>40%), they likely convey different detail
    const wordsA = new Set(normA.split(' '));
    const wordsB = new Set(normB.split(' '));
    const intersection = Array.from(wordsA).filter((w) => wordsB.has(w));
    const union = new Set([...Array.from(wordsA), ...Array.from(wordsB)]);
    const jaccard = intersection.length / Math.max(1, union.size);

    return jaccard < 0.65;
  }

  /**
   * Detects whether two items represent a direct contradiction rather than a duplicate.
   * e.g., Language conflict: "prefers English" vs "كلمني بالمصري"
   */
  public static isContradiction(itemA: ContextItem, itemB: ContextItem): boolean {
    const textA = (itemA.content || '').toLowerCase();
    const textB = (itemB.content || '').toLowerCase();

    // Language contradiction
    const englishA = textA.includes('english') || textA.includes('انجليزي');
    const arabicA = textA.includes('arabic') || textA.includes('عربي') || textA.includes('مصري');
    const englishB = textB.includes('english') || textB.includes('انجليزي');
    const arabicB = textB.includes('arabic') || textB.includes('عربي') || textB.includes('مصري');

    if ((englishA && arabicB) || (arabicA && englishB)) {
      return true;
    }

    // Verbosity contradiction
    const conciseA = textA.includes('concise') || textA.includes('مختصر');
    const detailedA = textA.includes('detailed') || textA.includes('مفصل');
    const conciseB = textB.includes('concise') || textB.includes('مختصر');
    const detailedB = textB.includes('detailed') || textB.includes('مفصل');

    if ((conciseA && detailedB) || (detailedA && conciseB)) {
      return true;
    }

    return false;
  }

  /**
   * Checks if two normalized strings share the same substantive core instruction.
   */
  private static sharesSubstantiveCore(normA: string, normB: string): boolean {
    if (normA === normB) return true;
    if (normA.includes(normB) || normB.includes(normA)) return true;

    const wordsA = new Set(normA.split(' '));
    const wordsB = new Set(normB.split(' '));
    const intersection = Array.from(wordsA).filter((w) => wordsB.has(w));
    const minWords = Math.min(wordsA.size, wordsB.size);

    return minWords > 0 && intersection.length / minWords >= 0.8;
  }

  /**
   * Identifies if a memory is purely an interaction style / verbosity preference,
   * rather than a factual/profile piece of knowledge about the user.
   */
  private static isPureStylePreference(normText: string): boolean {
    const factualIndicators = [
      'عمل', 'يعمل', 'مطور', 'مهندس', 'طالب', 'مبرمج', 'مهنة', 'وظيفة',
      'developer', 'engineer', 'architect', 'coder', 'programmer', 'works', 'job', 'role',
      'مشروع', 'تطبيق', 'متجر', 'نظام', 'موقع', 'app', 'project', 'system', 'builds', 'building',
      'debugging', 'testing', 'repo', 'repository', 'stack', 'tech',
      'عايش', 'مقيم', 'بلد', 'مدينة', 'lives', 'living', 'location', 'city', 'country',
      'مهتم', 'يحب', 'هواية', 'likes', 'interested', 'hobbies'
    ];

    if (factualIndicators.some((kw) => normText.includes(kw))) {
      return false;
    }

    const styleIndicators = [
      'concise', 'brief', 'short', 'مختصر', 'إيجاز', 'قصير',
      'detailed', 'long', 'thorough', 'مفصل', 'تفصيل', 'إسهاب',
      'formal', 'casual', 'رسمي', 'غير رسمي',
      'code snippets', 'أكواد'
    ];

    return styleIndicators.some((kw) => normText.includes(kw));
  }

  /**
   * Deduplicates memories across exact repetitions and against active personalization policies.
   * INVARIANT: Never collapses distinct facts, project descriptions, or debugging tasks!
   */
  public static deduplicateMemories(
    memories?: readonly string[],
    personalizationPolicy?: PersonalizationPolicy
  ): { readonly preserved: string[]; readonly removed: string[] } {
    if (!memories || memories.length === 0) {
      return { preserved: [], removed: [] };
    }

    const seenNorms = new Set<string>();
    const preserved: string[] = [];
    const removed: string[] = [];

    for (const mem of memories) {
      const cleanMem = mem.trim();
      if (!cleanMem) continue;
      const norm = this.normalizeSemanticContent(cleanMem);

      // Exact duplicate within memories
      if (seenNorms.has(norm)) {
        removed.push(cleanMem);
        continue;
      }

      // Check if memory is a pure style/verbosity directive that duplicates the active personalization policy
      // Invariant: Factual, professional, project, and profile memories are NEVER pruned against policy!
      if (personalizationPolicy && this.isPureStylePreference(norm)) {
        let isStyleDuplicate = false;

        if (
          personalizationPolicy.verbosityOverride === 'concise' &&
          (norm.includes('concise') || norm.includes('brief') || norm.includes('short') || norm.includes('مختصر') || norm.includes('إيجاز'))
        ) {
          isStyleDuplicate = true;
        } else if (
          personalizationPolicy.verbosityOverride === 'comprehensive' &&
          (norm.includes('detailed') || norm.includes('thorough') || norm.includes('comprehensive') || norm.includes('مفصل') || norm.includes('تفصيل'))
        ) {
          isStyleDuplicate = true;
        } else if (
          personalizationPolicy.formalityOverride === 'formal' &&
          (norm.includes('formal') || norm.includes('رسمي'))
        ) {
          isStyleDuplicate = true;
        }

        if (isStyleDuplicate) {
          removed.push(cleanMem);
          continue;
        }
      }

      seenNorms.add(norm);
      preserved.push(cleanMem);
    }

    return { preserved, removed };
  }
}
