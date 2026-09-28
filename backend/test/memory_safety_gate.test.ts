import { MemorySafetyGate } from '../src/modules/memory/memory_safety_gate';
import { MemoryCandidateExtractor } from '../src/modules/memory/memory_extractor';
import { MemoryRepository } from '../src/database/repositories/memory.repo';
import { SaveMemoryTool } from '../src/modules/tools/builtins/memory.tool';
import { UserPreferenceRepository } from '../src/database/repositories/user_preference.repo';
import { logger } from '../src/core/logger';

describe('Phase 4.5: Memory Extraction & Safety Gate', () => {
  let safetyGate: MemorySafetyGate;
  let extractor: MemoryCandidateExtractor;
  let memoryRepo: MemoryRepository;
  let saveMemoryTool: SaveMemoryTool;
  let userPrefRepo: UserPreferenceRepository;

  beforeEach(() => {
    safetyGate = MemorySafetyGate.getInstance();
    extractor = MemoryCandidateExtractor.getInstance();
    memoryRepo = new MemoryRepository();
    memoryRepo.clearInMemoryStore();
    saveMemoryTool = new SaveMemoryTool(memoryRepo);
    userPrefRepo = new UserPreferenceRepository();
  });

  describe('1. Safe User Facts (Allowed)', () => {
    test('allows legitimate professional and technical facts', () => {
      const decision1 = safetyGate.evaluate('المستخدم يعمل كمطور Flutter', 'profession');
      expect(decision1.allowed).toBe(true);
      expect(decision1.reason).toBe('safe');

      const decision2 = safetyGate.evaluate('المستخدم يستخدم Supabase', 'technical_context');
      expect(decision2.allowed).toBe(true);
      expect(decision2.reason).toBe('safe');

      const decision3 = safetyGate.evaluate('المستخدم يفضل الردود المختصرة', 'personality_preference');
      expect(decision3.allowed).toBe(true);
      expect(decision3.reason).toBe('safe');
    });

    test('allows normal numeric data without false positive blocking', () => {
      // Products with version numbers
      const decision1 = safetyGate.evaluate('عندي iPhone 15', 'stable_fact');
      expect(decision1.allowed).toBe(true);
      expect(decision1.reason).toBe('safe');

      // Duration or age statements
      const decision2 = safetyGate.evaluate('أنا أعمل في مجال البرمجة منذ 7 سنوات', 'profession');
      expect(decision2.allowed).toBe(true);
      expect(decision2.reason).toBe('safe');
    });

    test('allows general city and country residential facts', () => {
      const decision = safetyGate.evaluate('أنا أعيش في القاهرة', 'stable_fact');
      expect(decision.allowed).toBe(true);
      expect(decision.reason).toBe('safe');
    });
  });

  describe('2. Credentials & Secrets Detection (Blocked)', () => {
    test('blocks Arabic and English password declarations', () => {
      const decision1 = safetyGate.evaluate('كلمة المرور الخاصة بي هي 123456');
      expect(decision1.allowed).toBe(false);
      expect(decision1.reason).toBe('credential');

      const decision2 = safetyGate.evaluate('الباسورد بتاعي: secretPass2026!');
      expect(decision2.allowed).toBe(false);
      expect(decision2.reason).toBe('credential');

      const decision3 = safetyGate.evaluate('my password is SuperSecret99');
      expect(decision3.allowed).toBe(false);
      expect(decision3.reason).toBe('credential');
    });

    test('blocks API keys, Bearer tokens, and JWTs', () => {
      const decision1 = safetyGate.evaluate('API key: sk-proj1234567890abcdef1234567890abcdef');
      expect(decision1.allowed).toBe(false);
      expect(decision1.reason).toBe('credential');

      const decision2 = safetyGate.evaluate('Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozGz6bQ');
      expect(decision2.allowed).toBe(false);
      expect(decision2.reason).toBe('credential');

      const decision3 = safetyGate.evaluate('ghp_abcdefghijklmnopqrstuvwxyz1234567890');
      expect(decision3.allowed).toBe(false);
      expect(decision3.reason).toBe('credential');
    });
  });

  describe('3. One-Time Passwords & Security Codes (Blocked)', () => {
    test('blocks OTPs and verification codes in Arabic and English', () => {
      const decision1 = safetyGate.evaluate('رمز التحقق هو 482913');
      expect(decision1.allowed).toBe(false);
      expect(decision1.reason).toBe('security_code');

      const decision2 = safetyGate.evaluate('كود التأكيد: 918273');
      expect(decision2.allowed).toBe(false);
      expect(decision2.reason).toBe('security_code');

      const decision3 = safetyGate.evaluate('your verification code is 554433');
      expect(decision3.allowed).toBe(false);
      expect(decision3.reason).toBe('security_code');
    });
  });

  describe('4. Financial Payment Secrets (Blocked)', () => {
    test('blocks credit and debit card numbers', () => {
      const decision1 = safetyGate.evaluate('رقم الكارت هو 4111222233334444');
      expect(decision1.allowed).toBe(false);
      expect(decision1.reason).toBe('financial_secret');

      const decision2 = safetyGate.evaluate('my credit card is 5105 1051 0510 5105');
      expect(decision2.allowed).toBe(false);
      expect(decision2.reason).toBe('financial_secret');
    });

    test('blocks CVV and bank account credentials', () => {
      const decision1 = safetyGate.evaluate('CVV هو 123');
      expect(decision1.allowed).toBe(false);
      expect(decision1.reason).toBe('financial_secret');

      const decision2 = safetyGate.evaluate('رقم الحساب البنكي هو 12345678901234');
      expect(decision2.allowed).toBe(false);
      expect(decision2.reason).toBe('financial_secret');
    });
  });

  describe('5. Government Identifiers (Blocked)', () => {
    test('blocks National ID and Passport numbers', () => {
      const decision1 = safetyGate.evaluate('رقم البطاقة الشخصية هو 29801011234567');
      expect(decision1.allowed).toBe(false);
      expect(decision1.reason).toBe('government_identifier');

      const decision2 = safetyGate.evaluate('رقم جواز السفر هو A12345678');
      expect(decision2.allowed).toBe(false);
      expect(decision2.reason).toBe('government_identifier');

      const decision3 = safetyGate.evaluate('national id is 12345678901234');
      expect(decision3.allowed).toBe(false);
      expect(decision3.reason).toBe('government_identifier');
    });
  });

  describe('6. Medical / Health Diagnostic Information (Blocked)', () => {
    test('blocks automatic memory persistence of health, disease, and medication records', () => {
      const decision1 = safetyGate.evaluate('أنا باخد دواء للضغط يومياً');
      expect(decision1.allowed).toBe(false);
      expect(decision1.reason).toBe('health_data');

      const decision2 = safetyGate.evaluate('عندي السكر من 5 سنين');
      expect(decision2.allowed).toBe(false);
      expect(decision2.reason).toBe('health_data');

      const decision3 = safetyGate.evaluate('نتيجة التحليل الطبي أظهرت وجود التهاب');
      expect(decision3.allowed).toBe(false);
      expect(decision3.reason).toBe('health_data');
    });
  });

  describe('7. Precise Residential Address (Blocked)', () => {
    test('blocks detailed residential address with building or apartment details', () => {
      const decision = safetyGate.evaluate('عنوان بيتي بالتفصيل هو شارع النصر عمارة 4 شقة 10');
      expect(decision.allowed).toBe(false);
      expect(decision.reason).toBe('sensitive_address');
    });
  });

  describe('8. Memory Worthiness Filter', () => {
    test('rejects conversational fillers, greetings, and short tokens', () => {
      expect(safetyGate.evaluate('شكراً').allowed).toBe(false);
      expect(safetyGate.evaluate('تمام').allowed).toBe(false);
      expect(safetyGate.evaluate('ههههه').allowed).toBe(false);
      expect(safetyGate.evaluate('صباح الخير').allowed).toBe(false);
      expect(safetyGate.evaluate('ok').allowed).toBe(false);
      expect(safetyGate.evaluate('thanks').allowed).toBe(false);
    });

    test('rejects fleeting transient physical states', () => {
      expect(safetyGate.evaluate('أنا الآن جائع').allowed).toBe(false);
      expect(safetyGate.evaluate('رايح أنام خلاص').allowed).toBe(false);
      expect(safetyGate.evaluate('i am hungry').allowed).toBe(false);
    });

    test('accepts durable, meaningful user information', () => {
      expect(safetyGate.evaluate('أنا أعمل كمطور Flutter منذ 3 سنوات').allowed).toBe(true);
      expect(safetyGate.evaluate('المستخدم شغال مهندس برمجيات').allowed).toBe(true);
    });
  });

  describe('9. Tool Bypass Prevention (SaveMemoryTool)', () => {
    test('prevents SaveMemoryTool from persisting credentials even when explicitly requested', async () => {
      const result = await saveMemoryTool.execute(
        { fact: 'password = mySecretPass123', category: 'general' },
        { userId: 'test_user_tool_gate', conversationId: 'conv-1', channel: 'whatsapp' }
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('credential');

      // Verify repository remains empty
      const memories = await memoryRepo.getMemories('test_user_tool_gate');
      expect(memories).toHaveLength(0);
    });

    test('prevents SaveMemoryTool from persisting credit card numbers', async () => {
      const result = await saveMemoryTool.execute(
        { fact: 'رقم الكارت هو 4111222233334444', category: 'financial' },
        { userId: 'test_user_tool_gate_card', conversationId: 'conv-1', channel: 'whatsapp' }
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('financial_secret');

      const memories = await memoryRepo.getMemories('test_user_tool_gate_card');
      expect(memories).toHaveLength(0);
    });

    test('allows SaveMemoryTool for safe user facts', async () => {
      const result = await saveMemoryTool.execute(
        { fact: 'المستخدم مهتم بتعلم لغة Rust', category: 'interests' },
        { userId: 'test_user_tool_gate_safe', conversationId: 'conv-1', channel: 'whatsapp' }
      );

      expect(result.success).toBe(true);
      const memories = await memoryRepo.getMemories('test_user_tool_gate_safe');
      expect(memories).toContain('المستخدم مهتم بتعلم لغة Rust');
    });
  });

  describe('10. Safe Logging (Zero Sensitive Data Leaks)', () => {
    test('logger does NOT log the secret value itself when a candidate is blocked', () => {
      const warnSpy = jest.spyOn(logger, 'warn');
      const sensitivePassword = 'SecretPassword987!';

      safetyGate.evaluate(`كلمة المرور هي ${sensitivePassword}`);

      // Even when evaluate or repository logs, spy on warn calls to verify secret is NEVER in meta
      for (const call of warnSpy.mock.calls) {
        const metaStr = JSON.stringify(call);
        expect(metaStr).not.toContain(sensitivePassword);
      }

      warnSpy.mockRestore();
    });
  });

  describe('11. Extraction Decoupling & Preferences Isolation', () => {
    test('MemoryCandidateExtractor extracts candidates into structured objects', () => {
      const candidates = extractor.extractCandidates('انا اسمي طارق وشغال mobile dev flutter بالمناسبة');
      expect(candidates.length).toBeGreaterThanOrEqual(2);

      const nameCand = candidates.find((c) => c.category === 'identity');
      expect(nameCand?.factText).toBe('اسم المستخدم: طارق');
      expect(nameCand?.source).toBe('user_explicit');

      const profCand = candidates.find((c) => c.category === 'profession');
      expect(profCand?.factText).toContain('Flutter');
      expect(profCand?.source).toBe('automatic_extraction');
    });

    test('extractAndSaveFacts routes language preference to user_preferences and excludes it from memory_items', async () => {
      const userId = 'user_extraction_pref_test';
      const extracted = await memoryRepo.extractAndSaveFacts(
        userId,
        'انت ليه بتتكلم فصحي كلمني مصري عادي'
      );

      expect(extracted.length).toBeGreaterThanOrEqual(1);

      // Verify preference was stored in UserPreferenceRepository
      const langPref = await userPrefRepo.getLanguagePreference(userId);
      expect(langPref).toBeDefined();
      expect(langPref?.language).toBe('ar');
      expect(langPref?.dialect).toBe('egyptian');

      // Verify it was NOT persisted in memory_items
      const memories = await memoryRepo.getMemories(userId);
      expect(memories.some((m) => m.includes('المصرية'))).toBe(false);
      expect(memories.some((m) => m.includes('مصري'))).toBe(false);
    });
  });

  describe('12. Final Phase 4.5 Runtime Verifications', () => {
    test('routes "اتكلم معايا بالإنجليزي" to user_preferences without generic memory_items', async () => {
      const userId = 'user_lang_ar_en_' + Date.now();
      const extracted = await memoryRepo.extractAndSaveFacts(userId, 'اتكلم معايا بالإنجليزي');
      expect(extracted.length).toBeGreaterThanOrEqual(1);

      const langPref = await userPrefRepo.getLanguagePreference(userId);
      expect(langPref).toBeDefined();
      expect(langPref?.language).toBe('en');

      const memories = await memoryRepo.getMemories(userId);
      expect(memories.some((m) => m.toLowerCase().includes('english') || m.includes('إنجليزي'))).toBe(false);
    });

    test('routes "I prefer English" to user_preferences without generic memory_items', async () => {
      const userId = 'user_lang_en_pref_' + Date.now();
      const extracted = await memoryRepo.extractAndSaveFacts(userId, 'I prefer English');
      expect(extracted.length).toBeGreaterThanOrEqual(1);

      const langPref = await userPrefRepo.getLanguagePreference(userId);
      expect(langPref).toBeDefined();
      expect(langPref?.language).toBe('en');

      const memories = await memoryRepo.getMemories(userId);
      expect(memories.some((m) => m.toLowerCase().includes('english') || m.includes('إنجليزي'))).toBe(false);
    });

    test('routes "خليك مختصر في ردودك" to user_preferences without generic memory_items', async () => {
      const userId = 'user_personality_ar_' + Date.now();
      const extracted = await memoryRepo.extractAndSaveFacts(userId, 'خليك مختصر في ردودك');
      expect(extracted.length).toBeGreaterThanOrEqual(1);

      const personalityPref = await userPrefRepo.getPersonalityPreference(userId);
      expect(personalityPref).toBeDefined();
      expect(personalityPref?.verbosity).toBe('concise');

      const memories = await memoryRepo.getMemories(userId);
      expect(memories.some((m) => m.includes('مختصر') || m.toLowerCase().includes('concise'))).toBe(false);
    });

    test('routes "be concise in your answers" to user_preferences without generic memory_items', async () => {
      const userId = 'user_personality_en_' + Date.now();
      const extracted = await memoryRepo.extractAndSaveFacts(userId, 'be concise in your answers');
      expect(extracted.length).toBeGreaterThanOrEqual(1);

      const personalityPref = await userPrefRepo.getPersonalityPreference(userId);
      expect(personalityPref).toBeDefined();
      expect(personalityPref?.verbosity).toBe('concise');

      const memories = await memoryRepo.getMemories(userId);
      expect(memories.some((m) => m.includes('مختصر') || m.toLowerCase().includes('concise'))).toBe(false);
    });

    test('explicit safe memory via save_memory is allowed and persisted in memory_items', async () => {
      const userId = 'user_safe_mem_' + Date.now();
      const decision = safetyGate.evaluate('المستخدم يعمل كمطور Flutter', 'profession');
      expect(decision.allowed).toBe(true);

      const result = await saveMemoryTool.execute(
        { fact: 'المستخدم يعمل كمطور Flutter', category: 'profession' },
        { userId, conversationId: 'conv-safe', channel: 'whatsapp' }
      );

      expect(result.success).toBe(true);
      const memories = await memoryRepo.getMemories(userId);
      expect(memories).toContain('المستخدم يعمل كمطور Flutter');
    });

    test('explicit secret via save_memory is blocked and not added to memory_items', async () => {
      const userId = 'user_blocked_secret_' + Date.now();
      const result = await saveMemoryTool.execute(
        { fact: 'كلمة المرور الخاصة بي هي 123456', category: 'general' },
        { userId, conversationId: 'conv-secret', channel: 'whatsapp' }
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('credential');

      const memories = await memoryRepo.getMemories(userId);
      expect(memories).toHaveLength(0);
    });

    test('health statement "أنا باخد دواء X" is blocked and not saved as long-term memory', async () => {
      const userId = 'user_health_data_' + Date.now();
      const decision = safetyGate.evaluate('أنا باخد دواء X');
      expect(decision.allowed).toBe(false);
      expect(decision.reason).toBe('health_data');

      // Attempt automatic extraction
      const extracted = await memoryRepo.extractAndSaveFacts(userId, 'أنا باخد دواء X');
      expect(extracted).toHaveLength(0);

      // Attempt direct saveFact - must be rejected with error
      await expect(
        memoryRepo.saveFact(userId, 'أنا باخد دواء X', 'general')
      ).rejects.toThrow('health_data');
      const memories = await memoryRepo.getMemories(userId);
      expect(memories).toHaveLength(0);
    });
  });
});
