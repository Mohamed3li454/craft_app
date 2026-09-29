import {
  LanguageIntelligenceService,
  ExplicitInstructionDetector,
  DialectDetector,
  StyleDetector,
  LanguageContext,
  toCanonicalDialect,
  toDialectCode,
} from '../src/modules/language';
import { SystemPromptBuilder } from '../src/modules/ai/prompts/system_prompt';
import { PreflightStage } from '../src/modules/agent/pipeline/stages/preflight.stage';
import { CognitiveStage } from '../src/modules/agent/pipeline/stages/cognitive.stage';
import { MockAIProvider } from '../src/modules/ai';
import { TokenBudgetManager } from '../src/modules/context';

describe('Phase 9.4 — Adaptive Language Intelligence V2 Test Suite', () => {
  let service: LanguageIntelligenceService;

  beforeEach(() => {
    service = LanguageIntelligenceService.getInstance();
  });

  // =========================================================================
  // 1. Language Resolution (Scenarios 1–5)
  // =========================================================================
  describe('Language Resolution', () => {
    it('Scenario 1 — Arabic: Resolves standard Arabic with RTL text direction', () => {
      const result = service.resolveContext('ما هي عاصمة مصر؟');
      expect(result.targetLanguage).toBe('ar');
      expect(result.locale).toBe('ar');
      expect(result.textDirection).toBe('rtl');
      expect(result.source).toBe('current_message');
    });

    it('Scenario 2 — English: Resolves English with LTR text direction and en-US locale', () => {
      const result = service.resolveContext('How does the event loop work in Node.js?');
      expect(result.targetLanguage).toBe('en');
      expect(result.locale).toBe('en-US');
      expect(result.textDirection).toBe('ltr');
      expect(result.source).toBe('current_message');
    });

    it('Scenario 3 — French: Resolves French with fr-FR locale', () => {
      const result = service.resolveContext('Bonjour, comment vas-tu aujourd hui?');
      expect(result.targetLanguage).toBe('fr');
      expect(result.locale).toBe('fr-FR');
      expect(result.source).toBe('current_message');
    });

    it('Scenario 4 — Mixed Arabic/English: Identifies code-switching with Arabic framing', () => {
      const result = service.resolveContext('محتاج كود يعمل upload لملف على Supabase');
      expect(result.targetLanguage).toBe('ar');
      expect(result.textDirection).toBe('rtl');
      expect(result.codeSwitching?.isCodeSwitching).toBe(true);
      expect(result.codeSwitching?.primaryLanguage).toBe('ar');
      expect(result.codeSwitching?.preserveTechnicalTerms).toBe(true);
    });

    it('Scenario 5 — Technical Code-Switching: Detects preserved framework tokens', () => {
      const result = service.resolveContext('عايز اعمل setup لـ Flutter project مع Riverpod');
      expect(result.targetLanguage).toBe('ar');
      expect(result.codeSwitching?.isCodeSwitching).toBe(true);
      expect(result.codeSwitching?.preservedTerms?.some((t) => t.toLowerCase() === 'flutter')).toBe(true);
      expect(result.codeSwitching?.preservedTerms?.some((t) => t.toLowerCase() === 'riverpod')).toBe(true);
    });
  });

  // =========================================================================
  // 2. Egyptian Dialect Signals (Scenarios 6–10)
  // =========================================================================
  describe('Egyptian Dialect Signals', () => {
    it('Scenario 6 — "بص كده": Detects Egyptian Arabic with high confidence', () => {
      const result = service.resolveContext('بص كده على الكود ده وشوف المشكلة فين');
      expect(result.targetLanguage).toBe('ar');
      expect(result.dialect).toBe('egyptian');
      expect(result.locale).toBe('ar-EG');
      expect(result.dialectSignal?.confidence).toBeGreaterThanOrEqual(0.75);
      expect(result.dialectSignal?.confidenceBucket).toBe('high');
      expect(result.source).toBe('current_message');
    });

    it('Scenario 7 — "عايز أعرف": Detects Egyptian composite desire marker', () => {
      const result = service.resolveContext('عايز أعرف إيه الفرق بين Bloc و Cubit');
      expect(result.targetLanguage).toBe('ar');
      expect(result.dialect).toBe('egyptian');
      expect(result.dialectSignal?.confidence).toBeGreaterThanOrEqual(0.75);
    });

    it('Scenario 8 — "مفيش": Detects Egyptian negation lexical marker', () => {
      const result = service.resolveContext('مفيش أي بيانات راجعة من السيرفر خالص');
      expect(result.targetLanguage).toBe('ar');
      expect(result.dialect).toBe('egyptian');
      expect(result.dialectSignal?.confidence).toBeGreaterThanOrEqual(0.75);
    });

    it('Scenario 9 — "إزاي": Detects Egyptian interrogative marker', () => {
      const result = service.resolveContext('إزاي أعمل Dependency Injection في دارت؟');
      expect(result.targetLanguage).toBe('ar');
      expect(result.dialect).toBe('egyptian');
      expect(result.dialectSignal?.confidence).toBeGreaterThanOrEqual(0.75);
    });

    it('Scenario 10 — Ambiguous Arabic: Falls back safely to neutral standard Arabic', () => {
      const result = service.resolveContext('ما هو تاريخ تأسيس جامعة القاهرة وما هي كلياتها؟');
      expect(result.targetLanguage).toBe('ar');
      expect(result.dialect).toBeUndefined(); // Neutral Standard Arabic
      expect(result.locale).toBe('ar');
      expect(result.dialectSignal?.confidenceBucket).toBe('low');
    });
  });

  // =========================================================================
  // 3. Explicit Instruction Detection (Scenarios 11–15)
  // =========================================================================
  describe('Explicit Instruction Detection', () => {
    it('Scenario 11 — "كلمني بالمصري": Resolves Egyptian dialect via Tier 1', () => {
      const result = service.resolveContext('كلمني بالمصري لو سمحت');
      expect(result.targetLanguage).toBe('ar');
      expect(result.dialect).toBe('egyptian');
      expect(result.source).toBe('explicit_instruction');
      expect(result.explicitInstruction?.detected).toBe(true);
      expect(result.explicitInstruction?.requestedDialect).toBe('egyptian');
      expect(result.locale).toBe('ar-EG');
    });

    it('Scenario 12 — "Answer in English": Resolves English via Tier 1', () => {
      const result = service.resolveContext('Answer in English please');
      expect(result.targetLanguage).toBe('en');
      expect(result.source).toBe('explicit_instruction');
      expect(result.explicitInstruction?.detected).toBe(true);
      expect(result.explicitInstruction?.requestedLanguage).toBe('en');
      expect(result.locale).toBe('en-US');
    });

    it('Scenario 13 — "اختصر": Explicit instruction captures concise verbosity', () => {
      const result = service.resolveContext('اختصر الشرح ده في نقاط سريعة');
      expect(result.targetLanguage).toBe('ar');
      expect(result.verbosity).toBe('concise');
      expect(result.explicitInstruction?.detected).toBe(true);
      expect(result.explicitInstruction?.requestedVerbosity).toBe('concise');
    });

    it('Scenario 14 — "اشرح بالتفصيل": Explicit instruction captures detailed verbosity', () => {
      const result = service.resolveContext('اشرح بالتفصيل المعمارية المتبعة');
      expect(result.targetLanguage).toBe('ar');
      expect(result.verbosity).toBe('detailed');
      expect(result.explicitInstruction?.detected).toBe(true);
      expect(result.explicitInstruction?.requestedVerbosity).toBe('detailed');
    });

    it('Scenario 15 — "خليك رسمي": Explicit instruction captures formal register', () => {
      const result = service.resolveContext('خليك رسمي في كتابة هذا الخطاب');
      expect(result.targetLanguage).toBe('ar');
      expect(result.register).toBe('formal');
      expect(result.explicitInstruction?.detected).toBe(true);
      expect(result.explicitInstruction?.requestedRegister).toBe('formal');
    });
  });

  // =========================================================================
  // 4. Precedence Hierarchy & Current Turn Dominance (Scenarios 16–19)
  // =========================================================================
  describe('Precedence Hierarchy & Current Turn Dominance', () => {
    it('Scenario 16 — Stored English + Current Egyptian: Current turn strictly dominates over stored preference', () => {
      const result = service.resolveContext('بص فهمني دي', {
        storedPreference: { language: 'en' },
      });
      expect(result.targetLanguage).toBe('ar');
      expect(result.dialect).toBe('egyptian');
      expect(result.source).toBe('current_message');
      expect(result.locale).toBe('ar-EG');
    });

    it('Scenario 17 — Stored Egyptian + Explicit English: Tier 1 explicit overrides stored preference', () => {
      const result = service.resolveContext('Please answer in English.', {
        storedPreference: { language: 'ar', dialect: 'egyptian' },
      });
      expect(result.targetLanguage).toBe('en');
      expect(result.source).toBe('explicit_instruction');
      expect(result.locale).toBe('en-US');
    });

    it('Scenario 18 — Conversation Arabic + Explicit English: Explicit instruction overrides ongoing conversation language', () => {
      const result = service.resolveContext('switch to English please', {
        conversationLanguage: 'ar',
        recentMessages: [
          { role: 'user', text: 'السلام عليكم ورحمة الله' },
          { role: 'assistant', text: 'وعليكم السلام، كيف أساعدك اليوم؟' },
        ],
      });
      expect(result.targetLanguage).toBe('en');
      expect(result.source).toBe('explicit_instruction');
    });

    it('Scenario 19 — Conversation English + Explicit Egyptian: Explicit instruction switches context to Egyptian Arabic', () => {
      const result = service.resolveContext('عايز شرح بالمصري', {
        conversationLanguage: 'en',
        recentMessages: [
          { role: 'user', text: 'How does garbage collection work?' },
          { role: 'assistant', text: 'Garbage collection in Dart uses generational collection.' },
        ],
      });
      expect(result.targetLanguage).toBe('ar');
      expect(result.dialect).toBe('egyptian');
      expect(result.source).toBe('explicit_instruction');
      expect(result.locale).toBe('ar-EG');
    });
  });

  // =========================================================================
  // 5. Register Detection (Scenarios 20–23)
  // =========================================================================
  describe('Register Detection', () => {
    it('Scenario 20 — Casual: Detects informal slang and colloquial constructions', () => {
      const result = service.resolveContext('بص كده الكود ده واقع ليه يا عم؟');
      expect(result.register).toBe('casual');
    });

    it('Scenario 21 — Neutral: Detects standard balanced register without slang or stiff formality', () => {
      const result = service.resolveContext('ما هو الفرق بين StatefulWidget و StatelessWidget؟');
      expect(result.register).toBe('neutral');
    });

    it('Scenario 22 — Professional: Detects workplace courteous phrasing', () => {
      const result = service.resolveContext('ممكن توضيح المعمارية المقترحة للمشروع بالتفصيل؟');
      expect(result.register).toBe('professional');
    });

    it('Scenario 23 — Formal: Detects ceremonial or classical honorific phrasing', () => {
      const result = service.resolveContext('تحية طيبة وبعد، نحيطكم علماً برغبتنا في تقديم استفسار رسمي.');
      expect(result.register).toBe('formal');
    });
  });

  // =========================================================================
  // 6. Verbosity Detection (Scenarios 24–26)
  // =========================================================================
  describe('Verbosity Detection', () => {
    it('Scenario 24 — Concise: Identifies explicit requests for brevity', () => {
      const result = service.resolveContext('اختصر لي المقال ده في سطرين بالمختصر');
      expect(result.verbosity).toBe('concise');
    });

    it('Scenario 25 — Balanced: Defaults to balanced verbosity for standard inquiries', () => {
      const result = service.resolveContext('ما هي مميزات لغة Dart مقارنة بغيرها؟');
      expect(result.verbosity).toBe('balanced');
    });

    it('Scenario 26 — Detailed: Identifies explicit requests for thorough, step-by-step breakdown', () => {
      const result = service.resolveContext('اشرح بالتفصيل الممل خطوات إعداد CI/CD');
      expect(result.verbosity).toBe('detailed');
    });
  });

  // =========================================================================
  // 7. Code-Switching & Terminology Preservation (Scenarios 27–32)
  // =========================================================================
  describe('Code-Switching & Technical Preservation', () => {
    it('Scenario 27 — Arabic + Flutter: Identifies tech code-switching correctly', () => {
      const result = service.resolveContext('ممكن تشرح لي دور الـ State في Flutter');
      expect(result.targetLanguage).toBe('ar');
      expect(result.codeSwitching?.isCodeSwitching).toBe(true);
      expect(result.codeSwitching?.preserveTechnicalTerms).toBe(true);
      expect(result.codeSwitching?.preservedTerms?.some((t) => t.toLowerCase() === 'flutter')).toBe(true);
    });

    it('Scenario 28 — Arabic + REST API: Preserves REST, API, and Repository terms', () => {
      const result = service.resolveContext('عندي مشكلة في استدعاء الـ REST API من الـ Repository');
      expect(result.codeSwitching?.isCodeSwitching).toBe(true);
      expect(result.codeSwitching?.preservedTerms?.some((t) => t.toLowerCase() === 'api')).toBe(true);
      expect(result.codeSwitching?.preservedTerms?.some((t) => t.toLowerCase() === 'repository')).toBe(true);
    });

    it('Scenario 29 — English with Arabic Loan Greeting: Identifies English carrier', () => {
      const result = service.resolveContext('Hey Craft, I am working on this bug, تسلم يا غالي');
      expect(result.targetLanguage).toBe('en');
      expect(result.codeSwitching?.isCodeSwitching).toBe(true);
      expect(result.codeSwitching?.primaryLanguage).toBe('en');
    });

    it('Scenario 30 — SystemPromptBuilder: Injects strict technical preservation clause for Arabic', () => {
      const langCtx = service.resolveContext('بص اعمل refactor للـ repository دي');
      const instruction = SystemPromptBuilder.buildSystemInstruction(undefined, langCtx);
      expect(instruction).toContain('Technical Terminology Preservation');
      expect(instruction).toContain('NEVER translate core technical identifiers');
      expect(instruction).toContain('refactor');
      expect(instruction).toContain('repository');
    });

    it('Scenario 31 — Package Names Unchanged: Prohibits translating packages like flutter_bloc or riverpod', () => {
      const langCtx = service.resolveContext('عايز شرح لـ riverpod بالمصري');
      const instruction = SystemPromptBuilder.buildSystemInstruction(undefined, langCtx);
      expect(instruction).toContain('riverpod');
      expect(instruction).toContain('Egyptian Arabic');
    });

    it('Scenario 32 — CLI Commands Unchanged: Preserves exact terminal commands and code blocks', () => {
      const langCtx = service.resolveContext('كيف أثبت الحزم باستخدام flutter pub add؟');
      const instruction = SystemPromptBuilder.buildSystemInstruction(undefined, langCtx);
      expect(instruction).toContain('Keep all code blocks, class names, function names, and CLI commands strictly untranslated');
    });
  });

  // =========================================================================
  // 8. Memory Safety & Transient Signals (Scenarios 33–34)
  // =========================================================================
  describe('Memory Safety & Transient Signals', () => {
    it('Scenario 33 — Dialect Transient Signal: Transient colloquial turn is not automatically stored', () => {
      const result = service.resolveContext('بص كده');
      // The context is dynamically detected for the current turn
      expect(result.dialect).toBe('egyptian');
      expect(result.source).toBe('current_message');
      // Explicit instruction detected is false, ensuring transient colloquialisms
      // are not mistaken for a persistent explicit preference
      expect(result.explicitInstruction?.detected).toBeFalsy();
    });

    it('Scenario 34 — Explicit Persistent Preference: Detects explicit intent with persistent scope', () => {
      const explicit = ExplicitInstructionDetector.detect('كلمني دايمًا بالمصري');
      expect(explicit.detected).toBe(true);
      expect(explicit.requestedLanguage).toBe('ar');
      expect(explicit.requestedDialect).toBe('egyptian');
      expect(explicit.scope).toBe('persistent');
    });
  });

  // =========================================================================
  // 9. Confidence Bucketing (Scenarios 35–37)
  // =========================================================================
  describe('Confidence Bucketing & Thresholds', () => {
    it('Scenario 35 — High Confidence (>= 0.75): Multi-signal Egyptian markers yield high confidence', () => {
      const signal = DialectDetector.detect('بص كده عايز اعرف دلوقتي ازاي اعمل ده عشان يشتغل');
      expect(signal.dialect).toBe('egyptian');
      expect(signal.confidence).toBeGreaterThanOrEqual(0.75);
      expect(signal.confidenceBucket).toBe('high');
      expect(signal.evidenceTags.length).toBeGreaterThanOrEqual(2);
    });

    it('Scenario 36 — Medium Confidence (0.50–0.74): Single moderate marker yields medium confidence', () => {
      const signal = DialectDetector.detect('عايز اروح البيت');
      expect(signal.dialect).toBe('egyptian');
      expect(signal.confidence).toBeGreaterThanOrEqual(0.50);
      expect(signal.confidence).toBeLessThan(0.75);
      expect(signal.confidenceBucket).toBe('medium');
    });

    it('Scenario 37 — Low Confidence Fallback (< 0.50): Pure standard phrase without dialect markers yields low confidence unknown', () => {
      const signal = DialectDetector.detect('في الصباح الباكر ذهبت إلى السوق واشتريت الفاكهة');
      expect(signal.confidence).toBeLessThan(0.50);
      expect(signal.confidenceBucket).toBe('low');
      expect(signal.dialect).toBe('unknown');
    });
  });

  // =========================================================================
  // 10. Normalization Helpers & Type Compatibility
  // =========================================================================
  describe('Normalization Helpers', () => {
    it('converts between legacy and expanded dialect codes seamlessly', () => {
      expect(toCanonicalDialect('egyptian_ar')).toBe('egyptian');
      expect(toCanonicalDialect('gulf_ar')).toBe('gulf');
      expect(toCanonicalDialect('egyptian')).toBe('egyptian');
      expect(toDialectCode('egyptian')).toBe('egyptian_ar');
      expect(toDialectCode('gulf')).toBe('gulf_ar');
      expect(toDialectCode('msa')).toBe('msa');
      expect(toDialectCode('unknown')).toBe('unknown');
    });
  });

  // =========================================================================
  // 11. Section 23 Integration Scenarios
  // =========================================================================
  describe('Section 23 Integration Scenarios', () => {
    it('Integration Scenario 38: "بص فهمني يعني إيه dependency injection"', () => {
      const result = service.resolveContext('بص فهمني يعني إيه dependency injection');
      expect(result.targetLanguage).toBe('ar');
      expect(result.dialect).toBe('egyptian');
      expect(result.dialectSignal?.confidence).toBeGreaterThanOrEqual(0.75);
      expect(result.dialectSignal?.confidenceBucket).toBe('high');
      expect(result.codeSwitching?.isCodeSwitching).toBe(true);
      expect(result.codeSwitching?.preservedTerms?.some((t) => t.toLowerCase() === 'dependency injection')).toBe(true);
      expect(result.source).toBe('current_message');
      expect(result.locale).toBe('ar-EG');
    });

    it('Integration Scenario 39: "Please explain dependency injection in English."', () => {
      const result = service.resolveContext('Please explain dependency injection in English.');
      expect(result.targetLanguage).toBe('en');
      expect(result.source).toBe('explicit_instruction');
      expect(result.locale).toBe('en-US');
      expect(result.textDirection).toBe('ltr');
    });

    it('Integration Scenario 40: "عايز شرح مختصر بالمصري"', () => {
      const result = service.resolveContext('عايز شرح مختصر بالمصري');
      expect(result.targetLanguage).toBe('ar');
      expect(result.dialect).toBe('egyptian');
      expect(result.verbosity).toBe('concise');
      expect(result.source).toBe('explicit_instruction');
      expect(result.locale).toBe('ar-EG');
    });

    it('Integration Scenario 41: End-to-end Pipeline stage execution resolves LanguageContext in Preflight & Cognitive stages', async () => {
      const preflight = new PreflightStage();
      const cognitive = new CognitiveStage();

      const mockDeps: any = {
        userPreferenceRepo: {
          getLanguagePreference: jest.fn().mockResolvedValue({ language: 'en', dialect: undefined }),
          getPersonalityPreference: jest.fn().mockResolvedValue(null),
        },
        userRepo: {
          checkAndIncrementDailyLimit: jest.fn().mockResolvedValue({
            allowed: true,
            tier: 'free',
            limit: 40,
            remaining: 39,
          }),
        },
        chatRepo: {
          getOrCreateConversation: jest.fn().mockResolvedValue({ id: 'conv_123' }),
          saveMessage: jest.fn().mockResolvedValue({ id: 'msg_123' }),
          getRecentMessages: jest.fn().mockResolvedValue([]),
          consolidateWhatsAppConversations: jest.fn().mockResolvedValue(undefined),
        },
        chatMemoryRepo: {
          getRecentMessages: jest.fn().mockResolvedValue([]),
        },
        factMemoryRepo: {
          searchFactsByEmbedding: jest.fn().mockResolvedValue([]),
          getFactsByUser: jest.fn().mockResolvedValue([]),
        },
        memoryRetrievalService: {
          retrieve: jest.fn().mockResolvedValue([]),
        },
        groqProvider: new MockAIProvider(),
        tokenBudgetManager: TokenBudgetManager.getInstance(),
        memoryRepo: {
          extractAndSaveFacts: jest.fn().mockResolvedValue([]),
          getActiveMemories: jest.fn().mockResolvedValue([]),
        },
      };

      const ctx: any = {
        input: {
          userId: 'usr_adaptive_test',
          cleanUserText: 'بص فهمني يعني إيه dependency injection',
          channel: 'whatsapp',
        },
        cleanUserText: 'بص فهمني يعني إيه dependency injection',
        textToProcess: 'بص فهمني يعني إيه dependency injection',
        conversationState: {},
        recentMessages: [],
      };

      // 1. Preflight Stage execution
      await preflight.execute(ctx, mockDeps);

      expect(ctx.languageContext).toBeDefined();
      expect(ctx.languageContext.targetLanguage).toBe('ar');
      expect(ctx.languageContext.dialect).toBe('egyptian');
      expect(ctx.languageContext.codeSwitching?.isCodeSwitching).toBe(true);

      // 2. Cognitive Stage execution
      await cognitive.execute(ctx, mockDeps);

      expect(ctx.languageContext.targetLanguage).toBe('ar');
      expect(ctx.languageContext.dialect).toBe('egyptian');
      expect(ctx.languageContext.source).toBe('current_message');

      // 3. System Prompt Builder synthesized instruction
      const systemInstruction = SystemPromptBuilder.buildSystemInstruction(
        [],
        ctx.languageContext,
        ctx.personalityContext
      );

      expect(systemInstruction).toContain('Egyptian Arabic');
      expect(systemInstruction).toContain('Technical Terminology Preservation');
      expect(systemInstruction).toContain('NEVER translate core technical identifiers');
      expect(systemInstruction).toContain('dependency injection');
    });
  });
});
