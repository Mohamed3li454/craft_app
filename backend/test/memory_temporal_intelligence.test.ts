import { DatabaseManager } from '../src/database/connection';
import { MemoryRepository } from '../src/database/repositories/memory.repo';
import { MemoryEvidenceRepository } from '../src/database/repositories/memory_evidence.repo';
import { MemoryCandidateExtractor } from '../src/modules/memory/memory_extractor';
import { MemoryRetrievalService } from '../src/modules/memory/memory_retrieval.service';
import { MemoryContextAssembler } from '../src/modules/memory/memory_context_assembler';
import { parseTemporalIntent } from '../src/modules/memory/temporal_parser';
import { RetrievedMemory, MemoryItem } from '../src/modules/memory/types';

describe('Phase 2.4 — Temporal Intelligence & State Awareness', () => {
  let memoryRepo: MemoryRepository;
  let evidenceRepo: MemoryEvidenceRepository;
  let extractor: MemoryCandidateExtractor;
  let retrievalService: MemoryRetrievalService;
  let assembler: MemoryContextAssembler;

  const testUserId = `test_temporal_user_${Date.now()}`;

  beforeAll(() => {
    const db = DatabaseManager.getInstance();
    memoryRepo = new MemoryRepository(db);
    evidenceRepo = MemoryEvidenceRepository.getInstance(db);
    extractor = MemoryCandidateExtractor.getInstance();
    retrievalService = MemoryRetrievalService.getInstance(memoryRepo);
    assembler = MemoryContextAssembler.getInstance();
  });

  beforeEach(() => {
    memoryRepo.clearInMemoryStore();
    evidenceRepo.clearInMemoryStore();
  });

  // ============================================================================
  // 1. Temporal State Extraction (Arabic & English)
  // ============================================================================
  describe('1. Temporal State Extraction', () => {
    test('Historical (Arabic): "زمان كنت بستخدم React" -> historical', () => {
      const candidates = extractor.extractCandidates('زمان كنت بستخدم React');
      expect(candidates.length).toBeGreaterThan(0);
      const reactCand = candidates.find((c) => c.candidateKey?.includes('react'));
      expect(reactCand).toBeDefined();
      expect(reactCand?.temporalState).toBe('historical');
      expect(reactCand?.factText).toContain('سابقاً');
      expect(reactCand?.validUntil).toBeNull(); // Historical is NEVER expired!
    });

    test('Current (Arabic): "دلوقتي بستخدم Flutter" -> current', () => {
      const candidates = extractor.extractCandidates('دلوقتي بستخدم Flutter');
      expect(candidates.length).toBeGreaterThan(0);
      const flutterCand = candidates.find((c) => c.candidateKey?.includes('flutter'));
      expect(flutterCand).toBeDefined();
      expect(flutterCand?.temporalState).toBe('current');
      expect(flutterCand?.factText).toBe('المستخدم يعمل مع فلاتر (Flutter)');
    });

    test('Planned (Arabic): "الأسبوع الجاي هبدأ أتعلم Rust" -> planned', () => {
      const candidates = extractor.extractCandidates('الأسبوع الجاي هبدأ أتعلم Rust');
      expect(candidates.length).toBeGreaterThan(0);
      const rustCand = candidates.find((c) => c.candidateKey?.includes('rust'));
      expect(rustCand).toBeDefined();
      expect(rustCand?.temporalState).toBe('planned');
      expect(rustCand?.factText).toBe('المستخدم يخطط لتعلم رست (Rust)');
      // Planned != Current: does NOT state user currently works with Rust
      expect(rustCand?.factText).not.toContain('يعمل مع');
      expect(rustCand?.temporalMetadata?.relativeExpression).toBe('next_week');
      expect(rustCand?.validFrom).toBeNull(); // No invented fake timestamp!
    });

    test('Temporary (Arabic): "أنا بجرب React النهارده بس" -> temporary', () => {
      const candidates = extractor.extractCandidates('أنا بجرب React النهارده بس');
      expect(candidates.length).toBeGreaterThan(0);
      const reactCand = candidates.find((c) => c.candidateKey?.includes('react'));
      expect(reactCand).toBeDefined();
      expect(reactCand?.temporalState).toBe('temporary');
      expect(reactCand?.factText).toContain('بشكل مؤقت');
      expect(reactCand?.validUntil).toBeDefined();
      expect(reactCand?.validUntil).not.toBeNull();
      // Should expire within ~24 hours
      const diffHours = (reactCand!.validUntil!.getTime() - Date.now()) / (1000 * 3600);
      expect(diffHours).toBeGreaterThan(20);
      expect(diffHours).toBeLessThan(25);
    });

    test('English Support: historical, current, planned, temporary', () => {
      const hist = parseTemporalIntent('I used to work with React back then');
      expect(hist.temporalState).toBe('historical');

      const curr = parseTemporalIntent('Currently I use Flutter for development');
      expect(curr.temporalState).toBe('current');

      const plan = parseTemporalIntent('Next week I am going to start learning Rust');
      expect(plan.temporalState).toBe('planned');
      expect(plan.relativeExpression).toBe('next_week');

      const temp = parseTemporalIntent('I am testing this script for today only');
      expect(temp.temporalState).toBe('temporary');
      expect(temp.relativeExpression).toBe('today_only');
      expect(temp.validUntil).toBeDefined();
    });
  });

  // ============================================================================
  // 2. Continuity, Ambiguity, and Relative Dates
  // ============================================================================
  describe('2. Continuity, Ambiguity, and Relative Dates', () => {
    test('Continuity Resolution: "كنت بستخدم Flutter زمان ولسه بستخدمه دلوقتي" resolves to current', () => {
      const intent = parseTemporalIntent('كنت بستخدم Flutter زمان ولسه بستخدمه دلوقتي');
      // Must NOT be classified as historical blindly!
      expect(intent.temporalState).toBe('current');
      expect(intent.temporalSignal).toBe('continuity_resolved');
      expect(intent.temporalAmbiguity).toBe(false);

      const candidates = extractor.extractCandidates('كنت بستخدم Flutter زمان ولسه بستخدمه دلوقتي');
      const cand = candidates.find((c) => c.candidateKey?.includes('flutter'));
      expect(cand?.temporalState).toBe('current');
      expect(cand?.factText).toBe('المستخدم يعمل مع فلاتر (Flutter)');
    });

    test('Ambiguity: contradictory past and future without resolution preserves uncertainty', () => {
      const intent = parseTemporalIntent('زمان هبدأ مشروع جديد في المستقبل');
      expect(intent.temporalState).toBe('unknown');
      expect(intent.temporalAmbiguity).toBe(true);
      expect(intent.temporalConfidence).toBeLessThan(0.50);
    });

    test('Relative dates preserved as metadata without inventing arbitrary absolute dates', () => {
      const relWeek = parseTemporalIntent('الأسبوع الجاي هبدأ مشروع');
      expect(relWeek.relativeExpression).toBe('next_week');
      expect(relWeek.validFrom).toBeNull(); // Does not invent exact day/hour!

      const relTomorrow = parseTemporalIntent('بكرة هجرب كود جديد');
      expect(relTomorrow.relativeExpression).toBe('tomorrow');
      expect(relTomorrow.validFrom).toBeNull();

      const relAgo = parseTemporalIntent('من أسبوع كنت شغال على المشروع');
      expect(relAgo.relativeExpression).toBe('last_week');
      expect(relAgo.validFrom).toBeNull();
    });
  });

  // ============================================================================
  // 3. Temporal State Independence from Lifecycle & Importance
  // ============================================================================
  describe('3. Temporal State Independence from Lifecycle & Importance', () => {
    test('Historical != Expired: historical memory is active with validUntil = null', async () => {
      const saved = await memoryRepo.saveFact(
        testUserId,
        'المستخدم كان يعمل مع رياكت (React) سابقاً',
        'technical_context',
        {
          temporalState: 'historical',
          confidence: 0.95,
          importance: 'normal',
        }
      );

      expect(saved.temporalState).toBe('historical');
      expect(saved.status).toBe('active');
      expect(saved.validUntil).toBeNull();

      const activeMemories = await memoryRepo.getActiveMemories(testUserId);
      expect(activeMemories.some((m) => m.id === saved.id)).toBe(true);
    });

    test('Historical != Low Importance: historical memory can have high importance and high confidence', async () => {
      const saved = await memoryRepo.saveFact(
        testUserId,
        'المستخدم أسس شركة برمجيات سابقة في 2020',
        'stable_fact',
        {
          temporalState: 'historical',
          confidence: 0.98,
          importance: 'high',
        }
      );

      expect(saved.temporalState).toBe('historical');
      expect(saved.confidence).toBe(0.98);
      expect(saved.importance).toBe('high');
      expect(saved.status).toBe('active');
    });

    test('Planned != Current: planned goal recorded as planned intention, not current skill', () => {
      const candidates = extractor.extractCandidates('الأسبوع الجاي هبدأ أتعلم Rust');
      const rustCand = candidates.find((c) => c.candidateKey?.includes('rust'));
      expect(rustCand?.temporalState).toBe('planned');
      expect(rustCand?.factText).toContain('يخطط لتعلم');
      expect(rustCand?.factText).not.toContain('يعمل مع');
    });

    test('Temporary Expiration: temporary memory with past validUntil is excluded from active retrieval', async () => {
      const pastDate = new Date(Date.now() - 1000 * 60); // 1 minute ago
      const expiredTemporary = await memoryRepo.saveFact(
        testUserId,
        'المستخدم يجرب مكتبة اختبارات مؤقتة',
        'ephemeral_context',
        {
          temporalState: 'temporary',
          validUntil: pastDate,
        }
      );

      expect(expiredTemporary.status).toBe('expired');
      const active = await memoryRepo.getActiveMemories(testUserId);
      expect(active.some((m) => m.id === expiredTemporary.id)).toBe(false);
    });
  });

  // ============================================================================
  // 4. Evidence & Promotion Integration
  // ============================================================================
  describe('4. Evidence & Promotion Integration', () => {
    test('Evidence candidate records temporalState and promotes with correct temporalState', async () => {
      const candidateUser = `user_temporal_ev_${Date.now()}`;

      // Observation 1: Casual historical mention
      const obs1 = await evidenceRepo.recordObservation({
        userId: candidateUser,
        candidateKey: 'tech.react.historical',
        category: 'technical_context',
        rawSignal: 'زمان كنت بستخدم React',
        canonicalFact: 'المستخدم كان يعمل مع رياكت (React) سابقاً',
        source: 'automatic_extraction',
        confidence: 0.85,
        temporalState: 'historical',
        conversationId: 'conv_1',
      });

      expect(obs1.candidate.temporalState).toBe('historical');
      expect(obs1.shouldPromote).toBe(false);

      // Observation 2: Reinforce across conversation 2
      const obs2 = await evidenceRepo.recordObservation({
        userId: candidateUser,
        candidateKey: 'tech.react.historical',
        category: 'technical_context',
        rawSignal: 'زي ما قولتلك قبل كده كنت شغال مع React زمان',
        canonicalFact: 'المستخدم كان يعمل مع رياكت (React) سابقاً',
        source: 'automatic_extraction',
        confidence: 0.85,
        temporalState: 'historical',
        conversationId: 'conv_2',
      });

      expect(obs2.candidate.temporalState).toBe('historical');
      expect(obs2.shouldPromote).toBe(true);

      // Promote into memory_items
      const promoted = await memoryRepo.saveFact(
        candidateUser,
        obs2.candidate.canonicalFact,
        obs2.candidate.category,
        {
          source: 'automatic_extraction',
          confidence: obs2.candidate.confidence,
          importance: obs2.candidate.importance,
          temporalState: obs2.candidate.temporalState,
        }
      );

      expect(promoted.temporalState).toBe('historical');
      expect(promoted.status).toBe('active');
    });
  });

  // ============================================================================
  // 5. Retrieval Integration (Temporal Filtering & Boosting)
  // ============================================================================
  describe('5. Retrieval Integration (Temporal Filtering & Boosting)', () => {
    test('User asks about CURRENT work ("أنا شغال على إيه دلوقتي؟"): historical memory is penalized, current is selected', async () => {
      const retrievalUser = `user_retrieval_temporal_${Date.now()}`;

      // Memory A: Historical React
      await memoryRepo.saveFact(
        retrievalUser,
        'المستخدم كان يعمل مع رياكت (React) سابقاً',
        'technical_context',
        {
          temporalState: 'historical',
          confidence: 0.90,
          importance: 'normal',
        }
      );

      // Memory B: Current Flutter Developer
      await memoryRepo.saveFact(
        retrievalUser,
        'المستخدم يعمل كمطور تطبيقات هواتف باستخدام فلاتر (Mobile Flutter Developer)',
        'profession',
        {
          temporalState: 'current',
          confidence: 0.95,
          importance: 'high',
        }
      );

      // Query specifically asking about current state
      const results = await retrievalService.retrieve({
        userId: retrievalUser,
        message: 'أنا شغال على إيه دلوقتي؟',
      });

      expect(results.length).toBeGreaterThan(0);
      const topMemory = results[0];
      expect(topMemory.memory.factText).toContain('فلاتر');
      expect(topMemory.memory.temporalState).toBe('current');

      // Historical React memory should either be heavily penalized or excluded
      const historicalResult = results.find((r) => r.memory.temporalState === 'historical');
      if (historicalResult) {
        expect(historicalResult.relevanceScore).toBeLessThan(topMemory.relevanceScore);
        expect(historicalResult.retrievalReason).toContain('temporal_penalty:historical');
      }
    });

    test('User asks about HISTORICAL work ("إيه التقنيات اللي كنت بستخدمها زمان؟"): historical memory is boosted and selected', async () => {
      const retrievalUser = `user_retrieval_hist_${Date.now()}`;

      // Memory A: Historical React
      await memoryRepo.saveFact(
        retrievalUser,
        'المستخدم كان يعمل مع رياكت (React) سابقاً',
        'technical_context',
        {
          temporalState: 'historical',
          confidence: 0.90,
          importance: 'normal',
        }
      );

      // Memory B: Current Flutter
      await memoryRepo.saveFact(
        retrievalUser,
        'المستخدم يعمل كمطور تطبيقات هواتف باستخدام فلاتر (Mobile Flutter Developer)',
        'profession',
        {
          temporalState: 'current',
          confidence: 0.95,
          importance: 'high',
        }
      );

      const results = await retrievalService.retrieve({
        userId: retrievalUser,
        message: 'إيه التقنيات اللي كنت بستخدمها زمان؟',
      });

      expect(results.length).toBeGreaterThan(0);
      const reactResult = results.find((r) => r.memory.temporalState === 'historical');
      expect(reactResult).toBeDefined();
      expect(reactResult?.retrievalReason).toContain('temporal_boost:historical');
    });
  });

  // ============================================================================
  // 6. Context Assembly Representation
  // ============================================================================
  describe('6. Context Assembly Representation', () => {
    test('Formats temporal tags ([Historical], [Planned], [Temporary]) for non-current memories', () => {
      const items: RetrievedMemory[] = [
        {
          memory: {
            id: 'm1',
            userId: testUserId,
            factText: 'المستخدم يعمل كمطور تطبيقات هواتف باستخدام فلاتر (Mobile Flutter Developer)',
            category: 'profession',
            status: 'active',
            source: 'automatic_extraction',
            confidence: 0.95,
            importance: 'high',
            temporalState: 'current',
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          relevanceScore: 0.90,
          retrievalReason: 'current_match',
        },
        {
          memory: {
            id: 'm2',
            userId: testUserId,
            factText: 'المستخدم كان يعمل مع رياكت (React) سابقاً',
            category: 'technical_context',
            status: 'active',
            source: 'automatic_extraction',
            confidence: 0.90,
            importance: 'normal',
            temporalState: 'historical',
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          relevanceScore: 0.85,
          retrievalReason: 'historical_match',
        },
        {
          memory: {
            id: 'm3',
            userId: testUserId,
            factText: 'المستخدم يخطط لتعلم رست (Rust)',
            category: 'technical_context',
            status: 'active',
            source: 'automatic_extraction',
            confidence: 0.88,
            importance: 'normal',
            temporalState: 'planned',
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          relevanceScore: 0.80,
          retrievalReason: 'planned_match',
        },
      ];

      const context = assembler.assemble(items);
      expect(context.selectedCount).toBe(3);
      const promptText = context.formattedPromptText || '';

      // Current memory has standard clean format
      expect(promptText).toContain('• المستخدم يعمل كمطور تطبيقات هواتف باستخدام فلاتر');
      expect(promptText).not.toContain('• [Current] المستخدم يعمل كمطور');

      // Historical memory has [Historical] tag
      expect(promptText).toContain('• [Historical] المستخدم كان يعمل مع رياكت (React) سابقاً');

      // Planned memory has [Planned] tag
      expect(promptText).toContain('• [Planned] المستخدم يخطط لتعلم رست (Rust)');
    });
  });

  // ============================================================================
  // 7. Backward Compatibility & Neutral Unknown State Verification
  // ============================================================================
  describe('7. Backward Compatibility & Neutral Unknown State Verification', () => {
    test('1. Legacy memory without temporal info defaults to "unknown"', async () => {
      // Simulating a legacy row saved without temporalState
      const saved = await memoryRepo.saveFact(
        testUserId,
        'المستخدم يحب قراءة الكتب التقنية',
        'stable_fact'
      );

      expect(saved.temporalState).toBe('unknown');
    });

    test('2. Legacy memory does NOT appear as "current" due to migration default', () => {
      // In-memory or DB legacy row where temporalState is undefined
      const legacyItem: any = {
        id: 'legacy-mem-1',
        userId: testUserId,
        factText: 'المستخدم يفضل كتابة كود نظيف',
        category: 'stable_fact',
        status: 'active',
        // temporalState is intentionally omitted (simulating legacy pre-migration row)
      };

      const scoreResult = retrievalService.calculateRelevanceScore(
        'أنا شغال على إيه دلوقتي؟',
        ['شغال', 'دلوقتي'],
        new Set(['stable_fact']),
        legacyItem.factText,
        ['المستخدم', 'يفضل', 'كتابة', 'كود', 'نظيف'],
        'stable_fact',
        legacyItem
      );

      // Must NOT receive temporal_match:current
      expect(scoreResult.reason).not.toContain('temporal_match:current');
    });

    test('3. New explicit current statement -> "current"', () => {
      const explicitCurrent = parseTemporalIntent('دلوقتي بستخدم Flutter في شغلي اليومي');
      expect(explicitCurrent.temporalState).toBe('current');
      expect(explicitCurrent.temporalSignal).toBe('current_active');

      const candidates = extractor.extractCandidates('دلوقتي بستخدم Flutter');
      const flutterCand = candidates.find((c) => c.candidateKey?.includes('flutter'));
      expect(flutterCand?.temporalState).toBe('current');
    });

    test('4. New statement without temporal signal -> "unknown"', () => {
      const atemporalIntent = parseTemporalIntent('المستخدم يفضل كتابة كود نظيف');
      expect(atemporalIntent.temporalState).toBe('unknown');
      expect(atemporalIntent.temporalSignal).toBe('atemporal_default');

      // Extraction for neutral/atemporal statement
      const atemporalExtracted = parseTemporalIntent('React');
      expect(atemporalExtracted.temporalState).toBe('unknown');
    });

    test('5. Historical / planned / temporary remain unchanged', () => {
      const hist = parseTemporalIntent('زمان كنت بستخدم React');
      expect(hist.temporalState).toBe('historical');

      const plan = parseTemporalIntent('الأسبوع الجاي هبدأ أتعلم Rust');
      expect(plan.temporalState).toBe('planned');

      const temp = parseTemporalIntent('أنا بجرب الأداة دي النهارده بس');
      expect(temp.temporalState).toBe('temporary');
    });

    test('6. "unknown" is NOT automatically upgraded or downgraded in retrieval', () => {
      const unknownItem: any = {
        id: 'unknown-item-1',
        userId: testUserId,
        factText: 'المستخدم مهتم بالذكاء الاصطناعي',
        category: 'technical_context',
        status: 'active',
        source: 'automatic_extraction',
        confidence: 0.90,
        importance: 'normal',
        temporalState: 'unknown',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // 6a: Query about CURRENT: unknown does NOT get +0.05 boost and does NOT get -0.50 penalty
      const currScore = retrievalService.calculateRelevanceScore(
        'أنا شغال على إيه دلوقتي؟',
        ['شغال', 'دلوقتي'],
        new Set(['technical_context']),
        unknownItem.factText,
        ['المستخدم', 'مهتم', 'بالذكاء', 'الاصطناعي'],
        'technical_context',
        unknownItem
      );
      expect(currScore.reason).not.toContain('temporal_match:current');
      expect(currScore.reason).not.toContain('temporal_penalty');

      // 6b: Query about HISTORICAL: unknown does NOT get +0.35 boost and does NOT get -0.20 penalty
      const histScore = retrievalService.calculateRelevanceScore(
        'إيه التقنيات اللي كنت بستخدمها زمان؟',
        ['التقنيات', 'كنت', 'بستخدمها', 'زمان'],
        new Set(['technical_context']),
        unknownItem.factText,
        ['المستخدم', 'مهتم', 'بالذكاء', 'الاصطناعي'],
        'technical_context',
        unknownItem
      );
      expect(histScore.reason).not.toContain('temporal_boost:historical');
      expect(histScore.reason).not.toContain('temporal_penalty:current_not_historical');

      // 6c: Context Assembler treats "unknown" as clean text (no [Unknown] noise tag)
      const context = assembler.assemble([
        {
          memory: {
            ...unknownItem,
            temporalState: 'unknown',
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          relevanceScore: 0.75,
          retrievalReason: 'relevance_match',
        },
      ]);
      expect(context.formattedPromptText).toContain('• المستخدم مهتم بالذكاء الاصطناعي');
      expect(context.formattedPromptText).not.toContain('[Unknown]');
      expect(context.formattedPromptText).not.toContain('[Current]');
    });
  });
});
