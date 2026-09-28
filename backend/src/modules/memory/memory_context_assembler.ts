/**
 * Memory Architecture - Context Assembler (Phase 4.6)
 *
 * Assembles selectively retrieved user memories into a compact, deduplicated,
 * deterministic prompt context within strict character/token budgets.
 */

import {
  RetrievedMemory,
  MemoryContext,
  DEFAULT_MEMORY_RETRIEVAL_LIMIT,
  DEFAULT_MEMORY_CHAR_BUDGET,
  normalizeFactText,
} from './types';
import { MemorySafetyGate } from './memory_safety_gate';

export interface AssembleContextOptions {
  readonly language?: string;
  readonly maxItems?: number;
  readonly maxChars?: number;
}

export class MemoryContextAssembler {
  private static instance: MemoryContextAssembler;

  public static getInstance(): MemoryContextAssembler {
    if (!MemoryContextAssembler.instance) {
      MemoryContextAssembler.instance = new MemoryContextAssembler();
    }
    return MemoryContextAssembler.instance;
  }

  /**
   * Assembles a compact, budget-safe MemoryContext from retrieved memory items.
   */
  public assemble(
    retrieved: readonly RetrievedMemory[],
    options?: AssembleContextOptions
  ): MemoryContext {
    const totalCandidates = retrieved.length;
    if (totalCandidates === 0) {
      return {
        memories: [],
        totalCandidates: 0,
        selectedCount: 0,
        formattedPromptText: undefined,
      };
    }

    const maxItems = options?.maxItems ?? DEFAULT_MEMORY_RETRIEVAL_LIMIT;
    const maxChars = options?.maxChars ?? DEFAULT_MEMORY_CHAR_BUDGET;
    const isEnglish = options?.language === 'en';

    const selectedMemories: RetrievedMemory[] = [];
    const seenFactTexts = new Set<string>();
    let currentChars = 0;

    for (const item of retrieved) {
      if (selectedMemories.length >= maxItems) break;

      // Defense-in-depth: Safety Gate evaluation
      const safety = MemorySafetyGate.getInstance().evaluate(item.memory.factText, item.memory.category);
      if (!safety.allowed) {
        continue;
      }

      const normFact = normalizeFactText(item.memory.factText);
      const lowerNorm = normFact.toLowerCase();

      // Deduplication: prevent identical or whitespace-normalized duplicates in context
      if (seenFactTexts.has(lowerNorm)) {
        continue;
      }

      // Check character budget
      const state = item.memory.temporalState;
      const stateTag = state && state !== 'current' && state !== 'unknown'
        ? `[${state === 'historical' ? 'Historical' : state === 'planned' ? 'Planned' : 'Temporary'}] `
        : '';
      const factLineLength = normFact.length + stateTag.length + 4; // includes "• \n"
      if (currentChars + factLineLength > maxChars && selectedMemories.length > 0) {
        break; // budget limit reached
      }

      seenFactTexts.add(lowerNorm);
      selectedMemories.push(item);
      currentChars += factLineLength;
    }

    if (selectedMemories.length === 0) {
      return {
        memories: [],
        totalCandidates,
        selectedCount: 0,
        formattedPromptText: undefined,
      };
    }

    // Build compact prompt section
    const header = isEnglish
      ? '### Relevant User Context:'
      : '### Relevant User Context:';

    const bulletPoints = selectedMemories
      .map((item) => {
        const state = item.memory.temporalState;
        const tag = state && state !== 'current' && state !== 'unknown'
          ? `[${state === 'historical' ? 'Historical' : state === 'planned' ? 'Planned' : 'Temporary'}] `
          : '';
        return `• ${tag}${normalizeFactText(item.memory.factText)}`;
      })
      .join('\n');

    const formattedPromptText = `${header}\n${bulletPoints}`;

    return {
      memories: selectedMemories,
      totalCandidates,
      selectedCount: selectedMemories.length,
      formattedPromptText,
    };
  }

  /**
   * Helper to format memories into prompt string, or undefined if empty.
   */
  public toPromptSection(context: MemoryContext): string | undefined {
    if (!context || context.selectedCount === 0 || !context.formattedPromptText) {
      return undefined;
    }
    return context.formattedPromptText;
  }
}
