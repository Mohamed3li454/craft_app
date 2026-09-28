import { MemoryContextAssembler } from '../src/modules/memory/memory_context_assembler';
import { RetrievedMemory, MemoryItem } from '../src/modules/memory/types';

function createMockRetrievedMemory(
  id: string,
  factText: string,
  relevanceScore = 0.8,
  category = 'technical_context'
): RetrievedMemory {
  const memoryItem: MemoryItem = {
    id,
    userId: 'test_user',
    factText,
    category: category as any,
    status: 'active',
    source: 'automatic_extraction',
    confidence: 1.0,
    importance: 'normal',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  return {
    memory: memoryItem,
    relevanceScore,
    retrievalReason: 'test_reason',
  };
}

describe('Phase 4.6: MemoryContextAssembler', () => {
  let assembler: MemoryContextAssembler;

  beforeEach(() => {
    assembler = MemoryContextAssembler.getInstance();
  });

  describe('1. Empty Context Handling', () => {
    test('returns empty context and undefined prompt section when no memories retrieved', () => {
      const context = assembler.assemble([]);
      expect(context.selectedCount).toBe(0);
      expect(context.memories).toHaveLength(0);
      expect(context.formattedPromptText).toBeUndefined();

      const promptSection = assembler.toPromptSection(context);
      expect(promptSection).toBeUndefined();
    });
  });

  describe('2. Deduplication & Clean Formatting', () => {
    test('deduplicates identical facts even with whitespace variations', () => {
      const items: RetrievedMemory[] = [
        createMockRetrievedMemory('m1', 'المستخدم يعمل كمطور Flutter', 0.9),
        createMockRetrievedMemory('m2', ' المستخدم يعمل كمطور Flutter.  ', 0.85), // duplicate with spaces and period
        createMockRetrievedMemory('m3', 'المستخدم يستخدم Bloc', 0.7),
      ];

      const context = assembler.assemble(items);
      expect(context.totalCandidates).toBe(3);
      expect(context.selectedCount).toBe(2);
      expect(context.memories).toHaveLength(2);

      expect(context.formattedPromptText).toContain('المستخدم يعمل كمطور Flutter');
      expect(context.formattedPromptText).toContain('المستخدم يستخدم Bloc');
    });

    test('formats clean bullet points with header', () => {
      const items: RetrievedMemory[] = [
        createMockRetrievedMemory('m1', 'User works as a Mobile Flutter Developer', 0.9),
      ];

      const context = assembler.assemble(items, { language: 'en' });
      expect(context.selectedCount).toBe(1);
      expect(context.formattedPromptText).toBe(
        '### Relevant User Context:\n• User works as a Mobile Flutter Developer'
      );
    });
  });

  describe('3. Character & Item Budget Enforcement', () => {
    test('limits items to maxItems parameter', () => {
      const items: RetrievedMemory[] = [
        createMockRetrievedMemory('m1', 'Fact 1', 0.9),
        createMockRetrievedMemory('m2', 'Fact 2', 0.8),
        createMockRetrievedMemory('m3', 'Fact 3', 0.7),
        createMockRetrievedMemory('m4', 'Fact 4', 0.6),
      ];

      const context = assembler.assemble(items, { maxItems: 2 });
      expect(context.totalCandidates).toBe(4);
      expect(context.selectedCount).toBe(2);
      expect(context.memories).toHaveLength(2);
      expect(context.memories[0].memory.factText).toBe('Fact 1');
      expect(context.memories[1].memory.factText).toBe('Fact 2');
    });

    test('enforces character budget to prevent prompt bloat', () => {
      const longFact1 = 'A'.repeat(80);
      const longFact2 = 'B'.repeat(80);
      const longFact3 = 'C'.repeat(80);

      const items: RetrievedMemory[] = [
        createMockRetrievedMemory('m1', longFact1, 0.9),
        createMockRetrievedMemory('m2', longFact2, 0.8),
        createMockRetrievedMemory('m3', longFact3, 0.7),
      ];

      // Budget allows only ~100 characters, so only 1 fact fits
      const context = assembler.assemble(items, { maxChars: 120 });
      expect(context.selectedCount).toBe(1);
      expect(context.memories[0].memory.factText).toBe(longFact1);
    });
  });
});
