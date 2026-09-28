/**
 * Memory Architecture - Safety & Privacy Intelligence Test Suite (Phase 2.8)
 *
 * Exhaustively tests defense-in-depth safety invariants across:
 * - Deterministic safety classification (Scenarios A, B, C, M)
 * - Direct repository bypass protection (Scenario D)
 * - Repeated sensitive observation handling (Scenario E)
 * - Cross-conversation sensitive evidence insulation (Scenario F)
 * - Safe vs Sensitive consolidation protection (Scenario G)
 * - Historical state vs Blocked state separation (Scenario H)
 * - Defense-in-depth retrieval & context assembly filtering (Scenario I)
 * - Memory tool privacy and zero-secret leakage (Scenario J)
 * - Logging privacy (Scenario K)
 * - Backward compatibility with legacy memories (Scenario L)
 * - Concurrency safety under simultaneous sensitive observations (Scenario N)
 */

import { MemorySafetyGate } from '../src/modules/memory/memory_safety_gate';
import { MemoryRepository } from '../src/database/repositories/memory.repo';
import { MemoryEvidenceRepository } from '../src/database/repositories/memory_evidence.repo';
import { MemoryConsolidationService } from '../src/modules/memory/memory_consolidation.service';
import { MemoryRetrievalService } from '../src/modules/memory/memory_retrieval.service';
import { MemoryContextAssembler } from '../src/modules/memory/memory_context_assembler';
import { SaveMemoryTool } from '../src/modules/tools/builtins/memory.tool';
import { logger } from '../src/core/logger';
import { MemoryItemEntity } from '../src/database/repositories/types';
import { MemoryObservation, RetrievedMemory } from '../src/modules/memory/types';

describe('Phase 2.8: Memory Safety & Privacy Intelligence', () => {
  let safetyGate: MemorySafetyGate;
  let memoryRepo: MemoryRepository;
  let evidenceRepo: MemoryEvidenceRepository;
  let consolidationService: MemoryConsolidationService;
  let retrievalService: MemoryRetrievalService;
  let contextAssembler: MemoryContextAssembler;
  let saveMemoryTool: SaveMemoryTool;

  const createTestUserId = (prefix = 'safety') =>
    `${prefix}_user_${Math.random().toString(36).slice(2, 8)}_${Date.now()}`;

  beforeEach(() => {
    safetyGate = MemorySafetyGate.getInstance();
    memoryRepo = new MemoryRepository();
    memoryRepo.clearInMemoryStore();
    evidenceRepo = new MemoryEvidenceRepository();
    evidenceRepo.clearInMemoryStore();
    consolidationService = MemoryConsolidationService.getInstance();
    retrievalService = new MemoryRetrievalService(memoryRepo);
    contextAssembler = MemoryContextAssembler.getInstance();
    saveMemoryTool = new SaveMemoryTool(memoryRepo);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // Scenario A: Existing Safety Categories Coverage
  // ---------------------------------------------------------------------------
  describe('Scenario A: Existing Safety Categories Coverage', () => {
    test('blocks API keys, tokens, SSH keys, Bearer tokens, and secrets', () => {
      const keys = [
        'sk-proj1234567890abcdef1234567890abcdef',
        'sk-ant-api03-1234567890abcdef1234567890',
        'AIzaSyB1234567890abcdefghijklmnopqrstuvw',
        'AKIAIOSFODNN7EXAMPLE',
        'ghp_1234567890abcdefghijklmnopqrstuvwxyz',
        'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozGz6bQ',
        '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA0',
      ];

      for (const key of keys) {
        const dec = safetyGate.evaluate(key);
        expect(dec.allowed).toBe(false);
        expect(dec.reason).toBe('credential');
      }
    });

    test('blocks financial credentials (cards, CVV, bank accounts, IBANs)', () => {
      const financial = [
        '4111222233334444',
        '5105105105105105',
        'CVV هو 456',
        'card security code is 789',
        'رقم الحساب البنكي هو 98765432109876',
        'bank account number: 123456789012',
        'EG123456789012345678901234567890 IBAN',
      ];

      for (const item of financial) {
        const dec = safetyGate.evaluate(item);
        expect(dec.allowed).toBe(false);
        expect(dec.reason).toBe('financial_secret');
      }
    });

    test('blocks government identifiers (National ID, passport, SSN, driver license)', () => {
      const ids = [
        'الرقم القومي هو 29501011234567',
        'رقم البطاقة الشخصية هو 29801011234567',
        'رقم جواز السفر هو A12345678',
        'passport number is A98765432',
        'ssn is 123-45-6789',
        'رقم رخصة القيادة هو 12345678',
      ];

      for (const item of ids) {
        const dec = safetyGate.evaluate(item);
        expect(dec.allowed).toBe(false);
        expect(dec.reason).toBe('government_identifier');
      }
    });

    test('blocks security codes (OTP, 2FA, verification codes)', () => {
      const otps = [
        'رمز التحقق هو 582910',
        'كود التأكيد: 492019',
        'كود الـ otp هو 839201',
        'the verification code is 449201',
        'one-time code received is 938210',
        'كود استرجاع الحساب هو REC-1234-5678',
      ];

      for (const item of otps) {
        const dec = safetyGate.evaluate(item);
        expect(dec.allowed).toBe(false);
        expect(dec.reason).toBe('security_code');
      }
    });

    test('blocks medical diagnostic records and drug prescriptions', () => {
      const health = [
        'أنا مريض بـ السكر من 10 سنين',
        'أنا باخد دواء للضغط',
        'جرعة الدواء 50 مجم',
        'تشخيص الطبيب وجود قرحة بالمعدة',
        'i have diabetes and take insulin',
        'my prescription is metformin',
      ];

      for (const item of health) {
        const dec = safetyGate.evaluate(item);
        expect(dec.allowed).toBe(false);
        expect(dec.reason).toBe('health_data');
      }
    });

    test('blocks precise residential addresses with building/apartment numbers', () => {
      const addresses = [
        'عنوان بيتي هو شارع التحرير عمارة 15 شقة 4',
        'شارع النصر عمارة 10 دور 3 شقة 12',
        'my full address: 12 Elm Street building 4 apt 9',
        'عنوان بيتي بالتفصيل في شارع فيصل عمارة 5',
      ];

      for (const item of addresses) {
        const dec = safetyGate.evaluate(item);
        expect(dec.allowed).toBe(false);
        expect(dec.reason).toBe('sensitive_address');
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Scenario B: Rephrased Sensitive Data
  // ---------------------------------------------------------------------------
  describe('Scenario B: Rephrased Sensitive Data', () => {
    test('catches rephrased passwords in English and Arabic', () => {
      expect(safetyGate.evaluate('my password is TopSecretPassword2026').allowed).toBe(false);
      expect(safetyGate.evaluate('My password is secure_pass_123!').allowed).toBe(false);
      expect(safetyGate.evaluate('the password is Password123').allowed).toBe(false);
      expect(safetyGate.evaluate('كلمة السر بتاعتي هي SecretPass99').allowed).toBe(false);
      expect(safetyGate.evaluate('الباسورد بتاعي هو mySecret2026').allowed).toBe(false);
      expect(safetyGate.evaluate('باسوردي هو testpass123').allowed).toBe(false);
    });

    test('catches rephrased OTP declarations', () => {
      expect(safetyGate.evaluate('الـ OTP اللي وصلني هو 948201').allowed).toBe(false);
      expect(safetyGate.evaluate('the OTP I received is 583920').allowed).toBe(false);
      expect(safetyGate.evaluate('رمز otp بتاعي هو 123456').allowed).toBe(false);
    });

    test('catches rephrased national ID and passport declarations', () => {
      expect(safetyGate.evaluate('رقم بطاقتي هو 29901011234567').allowed).toBe(false);
      expect(safetyGate.evaluate('بطاقتي رقم 29901011234567').allowed).toBe(false);
      expect(safetyGate.evaluate('my passport is A12345678').allowed).toBe(false);
      expect(safetyGate.evaluate('رقم باسبوري هو A99887766').allowed).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Scenario C: Safe False Positives
  // ---------------------------------------------------------------------------
  describe('Scenario C: Safe False Positives (Should be Allowed)', () => {
    test('allows mentioning security tools without sensitive credentials', () => {
      const dec = safetyGate.evaluate('أنا بستخدم password manager لتنظيم حساباتي', 'preference');
      expect(dec.allowed).toBe(true);
      expect(dec.reason).toBe('safe');
    });

    test('allows general bank relationship mentions without account numbers', () => {
      const dec1 = safetyGate.evaluate('عندي حساب في البنك الأهلي', 'stable_fact');
      expect(dec1.allowed).toBe(true);
      expect(dec1.reason).toBe('safe');

      const dec2 = safetyGate.evaluate('أنا شغال في بنك مصر كمطور برمجيات', 'profession');
      expect(dec2.allowed).toBe(true);
      expect(dec2.reason).toBe('safe');
    });

    test('allows general city and country geographic locations', () => {
      const dec1 = safetyGate.evaluate('أنا عايش في القاهرة', 'stable_fact');
      expect(dec1.allowed).toBe(true);
      expect(dec1.reason).toBe('safe');

      const dec2 = safetyGate.evaluate('أنا مقيم في مصر حالياً', 'stable_fact');
      expect(dec2.allowed).toBe(true);
      expect(dec2.reason).toBe('safe');
    });

    test('allows products with version numbers or years of experience', () => {
      const dec1 = safetyGate.evaluate('عندي iPhone 15', 'stable_fact');
      expect(dec1.allowed).toBe(true);
      expect(dec1.reason).toBe('safe');

      const dec2 = safetyGate.evaluate('أنا أعمل في مجال البرمجة منذ 7 سنوات', 'profession');
      expect(dec2.allowed).toBe(true);
      expect(dec2.reason).toBe('safe');
    });
  });

  // ---------------------------------------------------------------------------
  // Scenario D: Direct Repository Bypass Protection
  // ---------------------------------------------------------------------------
  describe('Scenario D: Direct Repository Bypass Protection', () => {
    test('throws Error and creates 0 candidates when recordObservation receives sensitive canonicalFact', async () => {
      const testUserId = createTestUserId('scen_d1');
      const unsafeObs: MemoryObservation = {
        userId: testUserId,
        candidateKey: 'cred:pass',
        canonicalFact: 'my password is SuperSecretPass123',
        rawSignal: 'my password is SuperSecretPass123',
        confidence: 0.9,
        category: 'general',
        source: 'user_explicit',
        conversationId: 'conv-bypass-1',
      };

      await expect(evidenceRepo.recordObservation(unsafeObs)).rejects.toThrow(
        /Memory observation rejected by safety gate: credential/
      );

      // Verify 0 persistent evidence candidates
      const candidates = await evidenceRepo.getCandidates(testUserId);
      expect(candidates.length).toBe(0);
    });

    test('throws Error and creates 0 candidates when recordObservation receives sensitive rawSignal', async () => {
      const testUserId = createTestUserId('scen_d2');
      const unsafeObs: MemoryObservation = {
        userId: testUserId,
        candidateKey: 'safe:key',
        canonicalFact: 'المستخدم يفضل دارت',
        rawSignal: 'الباسورد بتاعي هو secret1234',
        confidence: 0.8,
        category: 'technical_context',
        source: 'automatic_extraction',
        conversationId: 'conv-bypass-2',
      };

      await expect(evidenceRepo.recordObservation(unsafeObs)).rejects.toThrow(
        /Memory observation rejected by safety gate: credential/
      );

      const candidates = await evidenceRepo.getCandidates(testUserId);
      expect(candidates.length).toBe(0);
    });

    test('sanitizes metadata.rawSignal if canonical fact is safe but rawSignal in metadata is sensitive', async () => {
      const testUserId = createTestUserId('scen_d3');
      const obsWithMeta: MemoryObservation = {
        userId: testUserId,
        candidateKey: 'safe:meta:key',
        canonicalFact: 'المستخدم مطور Flutter',
        rawSignal: 'المستخدم مطور Flutter',
        confidence: 0.85,
        category: 'profession',
        source: 'user_explicit',
        conversationId: 'conv-bypass-3',
        metadata: {
          clientApp: 'craft',
          rawSignal: 'كلمة السر: myPassword123',
        },
      };

      const { candidate } = await evidenceRepo.recordObservation(obsWithMeta);
      expect(candidate).toBeDefined();
      expect(candidate.metadata?.rawSignal).toBeUndefined();
      expect(candidate.metadata?.clientApp).toBe('craft');
    });

    test('saveFact blocks sensitive text directly and creates 0 memories', async () => {
      const testUserId = createTestUserId('scen_d4');
      await expect(
        memoryRepo.saveFact(
          testUserId,
          'my password is LeakedSecret999!',
          'general'
        )
      ).rejects.toThrow(/Memory fact rejected by safety gate: credential/);

      const active = await memoryRepo.getActiveMemories(testUserId);
      expect(active.length).toBe(0);
    });

    test('saveFact strips sensitive rawSignal from metadata when saving safe fact', async () => {
      const testUserId = createTestUserId('scen_d5');
      const item = await memoryRepo.saveFact(
        testUserId,
        'المستخدم يفضل نمط clean architecture',
        'technical_context',
        {
          metadata: {
            theme: 'dark',
            rawSignal: 'الباسورد بتاعي: 12345678',
          },
        }
      );

      expect(item).not.toBeNull();
      expect(item?.factText).toBe('المستخدم يفضل نمط clean architecture');
      expect(item?.metadata?.theme).toBe('dark');
      expect(item?.metadata?.rawSignal).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Scenario E: Repeated Sensitive Observation (10x Repeated)
  // ---------------------------------------------------------------------------
  describe('Scenario E: Repeated Sensitive Observation', () => {
    test('10 repeated attempts to record sensitive observation are all blocked, producing 0 evidence and 0 promotion', async () => {
      const testUserId = createTestUserId('scen_e');
      const unsafeObs: MemoryObservation = {
        userId: testUserId,
        candidateKey: 'repeated:secret',
        canonicalFact: 'الـ OTP اللي وصلني هو 593821',
        rawSignal: 'الـ OTP اللي وصلني هو 593821',
        confidence: 0.9,
        category: 'general',
        source: 'user_explicit',
        conversationId: 'conv-repeat-1',
      };

      for (let i = 0; i < 10; i++) {
        await expect(evidenceRepo.recordObservation(unsafeObs)).rejects.toThrow(
          /Memory observation rejected by safety gate/
        );
      }

      const candidates = await evidenceRepo.getCandidates(testUserId);
      expect(candidates.length).toBe(0);

      const activeMemories = await memoryRepo.getActiveMemories(testUserId);
      expect(activeMemories.length).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Scenario F: Cross-Conversation Sensitive Evidence
  // ---------------------------------------------------------------------------
  describe('Scenario F: Cross-Conversation Sensitive Evidence', () => {
    test('diversity across multiple conversations never overrides safety check', async () => {
      const testUserId = createTestUserId('scen_f');
      const conversations = ['conv-alpha', 'conv-beta', 'conv-gamma', 'conv-delta'];

      for (const convId of conversations) {
        const obs: MemoryObservation = {
          userId: testUserId,
          candidateKey: 'cross:conv:sensitive',
          canonicalFact: 'رقم بطاقتي هو 29901011234567',
          rawSignal: 'رقم بطاقتي هو 29901011234567',
          confidence: 0.9,
          category: 'stable_fact',
          source: 'user_explicit',
          conversationId: convId,
        };

        await expect(evidenceRepo.recordObservation(obs)).rejects.toThrow(
          /Memory observation rejected by safety gate: government_identifier/
        );
      }

      // Ensure no candidate or conversation diversity was tracked
      const candidates = await evidenceRepo.getCandidates(testUserId);
      expect(candidates.length).toBe(0);

      // No memory promoted
      const memories = await memoryRepo.getActiveMemories(testUserId);
      expect(memories.length).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Scenario G: Sensitive + Safe Consolidation Protection
  // ---------------------------------------------------------------------------
  describe('Scenario G: Sensitive + Safe Consolidation Protection', () => {
    test('rejects consolidation when candidate is sensitive, leaving canonical memory untouched', async () => {
      const testUserId = createTestUserId('scen_g');
      // 1. Create a legitimate active memory
      const safeMemory = await memoryRepo.saveFact(
        testUserId,
        'المستخدم يعمل كمطور برمجيات أول بلغة فلاتر',
        'profession'
      );
      expect(safeMemory).not.toBeNull();

      // 2. Evaluate consolidation with a sensitive candidate
      const result = consolidationService.evaluateConsolidation(
        {
          factText: 'الباسورد بتاعي هو FlutterDev2026',
          category: 'profession',
          factKey: safeMemory!.factKey,
        },
        [safeMemory!]
      );

      expect(result.action).toBe('keep_separate');
      expect(result.signals).toContain('safety_gate_blocked');
      expect(result.signals).toContain('credential');

      // 3. Verify safe memory was not altered or merged
      const active = await memoryRepo.getActiveMemories(testUserId);
      expect(active.length).toBe(1);
      expect(active[0].factText).toBe('المستخدم يعمل كمطور برمجيات أول بلغة فلاتر');
    });

    test('skips unsafe existing memories during consolidation evaluation', () => {
      const testUserId = createTestUserId('scen_g2');
      const unsafeExisting: MemoryItemEntity = {
        id: 'mem-unsafe-corrupted',
        userId: testUserId,
        factText: 'API key: sk-ant-api03-1234567890abcdef',
        category: 'technical_context',
        source: 'user_explicit',
        confidence: 0.9,
        importance: 'high',
        temporalState: 'current',
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const safeCandidate = {
        factText: 'المستخدم يستخدم مكتبة Bloc في إدارة الحالة',
        category: 'technical_context',
      };

      const result = consolidationService.evaluateConsolidation(safeCandidate, [unsafeExisting]);
      // Should not merge into the unsafe existing memory
      expect(result.action).toBe('keep_separate');
      expect(result.canonicalMemoryId).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Scenario H: Historical Blocked Memory (Blocked != Historical)
  // ---------------------------------------------------------------------------
  describe('Scenario H: Historical Blocked Memory', () => {
    test('blocked sensitive facts cannot be saved under temporalState: historical', async () => {
      const testUserId = createTestUserId('scen_h');
      await expect(
        memoryRepo.saveFact(
          testUserId,
          'كنت بستخدم باسورد قديم: OldPassword123',
          'general',
          {
            temporalState: 'historical',
          }
        )
      ).rejects.toThrow(/Memory fact rejected by safety gate: credential/);

      const active = await memoryRepo.getActiveMemories(testUserId);
      expect(active.length).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Scenario I: Retrieval & Context Assembly Safety (Defense-in-Depth)
  // ---------------------------------------------------------------------------
  describe('Scenario I: Retrieval & Context Assembly Safety', () => {
    test('retrieval filters out unsafe memory even if returned by database storage', async () => {
      const testUserId = createTestUserId('scen_i');
      const safeItem: MemoryItemEntity = {
        id: 'mem-safe-1',
        userId: testUserId,
        factText: 'المستخدم يفضل TypeScript في الباك إند',
        category: 'technical_context',
        source: 'user_explicit',
        confidence: 0.9,
        importance: 'normal',
        temporalState: 'current',
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const unsafeInjectedItem: MemoryItemEntity = {
        id: 'mem-unsafe-injected',
        userId: testUserId,
        factText: 'password: LeakedSecretValue123',
        category: 'technical_context',
        source: 'user_explicit',
        confidence: 0.9,
        importance: 'high',
        temporalState: 'current',
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      jest.spyOn(memoryRepo, 'getActiveMemories').mockResolvedValue([safeItem, unsafeInjectedItem]);

      const retrieved = await retrievalService.retrieve({
        userId: testUserId,
        message: 'أنا بكتب كود TypeScript ومحتاج مساعدة ومعايا password',
      });

      // Unsafe item must be strictly excluded
      expect(retrieved.some((r) => r.memory.id === 'mem-unsafe-injected')).toBe(false);
      expect(retrieved.some((r) => r.memory.id === 'mem-safe-1')).toBe(true);
    });

    test('context assembler excludes unsafe memories from formatted prompt context', () => {
      const testUserId = createTestUserId('scen_i2');
      const retrievedItems: RetrievedMemory[] = [
        {
          memory: {
            id: 'mem-safe-2',
            userId: testUserId,
            factText: 'المستخدم يعمل كمطور فلاتر',
            category: 'profession',
            source: 'user_explicit',
            confidence: 0.85,
            importance: 'normal',
            temporalState: 'current',
            status: 'active',
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          relevanceScore: 0.9,
          retrievalReason: 'category_match',
        },
        {
          memory: {
            id: 'mem-unsafe-leak',
            userId: testUserId,
            factText: 'رمز التحقق هو 992812',
            category: 'general',
            source: 'user_explicit',
            confidence: 0.95,
            importance: 'high',
            temporalState: 'current',
            status: 'active',
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          relevanceScore: 0.95,
          retrievalReason: 'category_match',
        },
      ];

      const context = contextAssembler.assemble(retrievedItems);
      expect(context.selectedCount).toBe(1);
      expect(context.memories.length).toBe(1);
      expect(context.memories[0].memory.id).toBe('mem-safe-2');
      expect(context.formattedPromptText).toContain('المستخدم يعمل كمطور فلاتر');
      expect(context.formattedPromptText).not.toContain('رمز التحقق هو');
    });
  });

  // ---------------------------------------------------------------------------
  // Scenario J: Memory Tool Safety & Zero Secret Leakage
  // ---------------------------------------------------------------------------
  describe('Scenario J: Memory Tool Safety', () => {
    test('SaveMemoryTool rejects credentials and returned error does not leak the secret', async () => {
      const testUserId = createTestUserId('scen_j1');
      const secretToSave = 'SuperSecretKey_1234567890';
      const result = await saveMemoryTool.execute(
        {
          fact: `my password is ${secretToSave}`,
          category: 'general',
        },
        {
          userId: testUserId,
          sessionId: 'session-tool-1',
          languageContext: { targetLanguage: 'en' },
        } as any
      );

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toContain('credential');
      // Must NOT leak the secret in the user-facing error message
      expect(result.error).not.toContain(secretToSave);

      const active = await memoryRepo.getActiveMemories(testUserId);
      expect(active.length).toBe(0);
    });

    test('SaveMemoryTool Arabic error message does not leak the secret', async () => {
      const testUserId = createTestUserId('scen_j2');
      const secretVal = '98765432101234';
      const result = await saveMemoryTool.execute(
        {
          fact: `رقم البطاقة الشخصية هو ${secretVal}`,
          category: 'stable_fact',
        },
        {
          userId: testUserId,
          sessionId: 'session-tool-2',
          languageContext: { targetLanguage: 'ar' },
        } as any
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('بوابة الأمان والخصوصية');
      expect(result.error).toContain('government_identifier');
      expect(result.error).not.toContain(secretVal);

      const active = await memoryRepo.getActiveMemories(testUserId);
      expect(active.length).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Scenario K: Logging Privacy
  // ---------------------------------------------------------------------------
  describe('Scenario K: Logging Privacy', () => {
    test('logger.warn does not leak the sensitive text when an observation is rejected', async () => {
      const testUserId = createTestUserId('scen_k');
      const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => {});

      const secretText = 'my password is SuperSecretUnlogged123';
      const obs: MemoryObservation = {
        userId: testUserId,
        candidateKey: 'log:privacy:test',
        canonicalFact: secretText,
        rawSignal: secretText,
        confidence: 0.9,
        category: 'general',
        source: 'user_explicit',
        conversationId: 'conv-log-1',
      };

      try {
        await evidenceRepo.recordObservation(obs);
      } catch (e) {
        // Expected error
      }

      expect(warnSpy).toHaveBeenCalled();
      for (const call of warnSpy.mock.calls) {
        const [message, meta] = call;
        expect(message).not.toContain(secretText);
        if (meta && typeof meta === 'object') {
          const jsonMeta = JSON.stringify(meta);
          expect(jsonMeta).not.toContain(secretText);
          expect(meta).toHaveProperty('reason');
          expect(meta).toHaveProperty('category');
        }
      }

      warnSpy.mockRestore();
    });
  });

  // ---------------------------------------------------------------------------
  // Scenario L: Legacy Compatibility
  // ---------------------------------------------------------------------------
  describe('Scenario L: Legacy Compatibility', () => {
    test('legacy safe memories without new safety metadata retrieve normally', async () => {
      const testUserId = createTestUserId('scen_l');
      const legacyItem: MemoryItemEntity = {
        id: 'legacy-mem-001',
        userId: testUserId,
        factText: 'المستخدم يفضل كود موثق بشكل احترافي',
        category: 'preference',
        source: 'user_explicit',
        confidence: 0.8,
        importance: 'normal',
        status: 'active',
        createdAt: new Date('2025-01-01'),
        updatedAt: new Date('2025-01-01'),
      };

      jest.spyOn(memoryRepo, 'getActiveMemories').mockResolvedValue([legacyItem]);

      const retrieved = await retrievalService.retrieve({
        userId: testUserId,
        message: 'كود موثق احترافي',
      });

      expect(retrieved.length).toBe(1);
      expect(retrieved[0].memory.id).toBe('legacy-mem-001');
      expect(retrieved[0].memory.factText).toBe('المستخدم يفضل كود موثق بشكل احترافي');
    });
  });

  // ---------------------------------------------------------------------------
  // Scenario M: Arabic / English Parity
  // ---------------------------------------------------------------------------
  describe('Scenario M: Arabic / English Parity', () => {
    const pairs: Array<{ ar: string; en: string; expectedReason: string }> = [
      {
        ar: 'كلمة المرور الخاصة بي هي Pass1234!',
        en: 'my password is Pass1234!',
        expectedReason: 'credential',
      },
      {
        ar: 'كود التأكيد: 582910',
        en: 'the verification code is 582910',
        expectedReason: 'security_code',
      },
      {
        ar: 'رقم البطاقة الائتمانية هو 4111222233334444',
        en: 'my credit card is 4111222233334444',
        expectedReason: 'financial_secret',
      },
      {
        ar: 'رقم جواز السفر هو A12345678',
        en: 'my passport is A12345678',
        expectedReason: 'government_identifier',
      },
    ];

    test.each(pairs)(
      'evaluates Arabic and English symmetrically for $expectedReason',
      ({ ar, en, expectedReason }) => {
        const arDecision = safetyGate.evaluate(ar);
        const enDecision = safetyGate.evaluate(en);

        expect(arDecision.allowed).toBe(false);
        expect(enDecision.allowed).toBe(false);
        expect(arDecision.reason).toBe(expectedReason);
        expect(enDecision.reason).toBe(expectedReason);
      }
    );
  });

  // ---------------------------------------------------------------------------
  // Scenario N: Concurrent Sensitive Observations
  // ---------------------------------------------------------------------------
  describe('Scenario N: Concurrent Sensitive Observations', () => {
    test('multiple simultaneous sensitive observations all fail safely with 0 persisted candidates', async () => {
      const testUserId = createTestUserId('scen_n');
      const concurrentRequests: MemoryObservation[] = Array.from({ length: 5 }, (_, idx) => ({
        userId: testUserId,
        candidateKey: `concurrent:secret:${idx}`,
        canonicalFact: `the password is Secret${idx}`,
        rawSignal: `the password is Secret${idx}`,
        confidence: 0.9,
        category: 'general',
        source: 'user_explicit',
        conversationId: `conv-conc-${idx}`,
      }));

      const results = await Promise.allSettled(
        concurrentRequests.map((req) => evidenceRepo.recordObservation(req))
      );

      // All 5 must reject
      for (const res of results) {
        expect(res.status).toBe('rejected');
      }

      // 0 candidates persisted
      const candidates = await evidenceRepo.getCandidates(testUserId);
      expect(candidates.length).toBe(0);

      // 0 memories persisted
      const facts = await memoryRepo.getActiveMemories(testUserId);
      expect(facts.length).toBe(0);
    });
  });
});
