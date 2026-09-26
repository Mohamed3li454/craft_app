import {
  LanguageIntelligenceService,
  ExplicitInstructionDetector,
  LanguageContext,
} from '../src/modules/language';

describe('Language Intelligence Suite (Phase 1 Core)', () => {
  let service: LanguageIntelligenceService;

  beforeEach(() => {
    service = LanguageIntelligenceService.getInstance();
  });

  // ===========================================================================
  // 1. Explicit Instruction Detection
  // ===========================================================================
  describe('Tier 1: Explicit Instruction Detection', () => {
    it('detects explicit English requests in Arabic correctly', () => {
      const cases = [
        'كلمني بالإنجليزي',
        'اتكلم بالإنجليزي',
        'تكلم بالانجليزي',
        'بالإنجليزي لو سمحت',
        'رد بالإنجليزي',
        'خليك English',
        'ممكن تكلمني انجليزي',
        'عاوزك ترد بالانجليزي',
      ];

      for (const phrase of cases) {
        const result = service.resolveContext(phrase);
        expect(result.targetLanguage).toBe('en');
        expect(result.source).toBe('explicit_instruction');
        expect(result.confidence).toBeGreaterThanOrEqual(0.95);
        expect(result.explicitInstruction?.detected).toBe(true);
        expect(result.explicitInstruction?.requestedLanguage).toBe('en');
        expect(result.locale).toBe('en-US');
        expect(result.textDirection).toBe('ltr');
      }
    });

    it('detects explicit English requests in English correctly', () => {
      const cases = [
        'Speak English',
        'Speak English please',
        'English please',
        'in English please',
        'Why are you speaking Arabic?',
        'I said speak English',
        "didn't I say speak English?",
        'switch to English',
        'use English',
      ];

      for (const phrase of cases) {
        const result = service.resolveContext(phrase);
        expect(result.targetLanguage).toBe('en');
        expect(result.source).toBe('explicit_instruction');
        expect(result.explicitInstruction?.detected).toBe(true);
        expect(result.explicitInstruction?.requestedLanguage).toBe('en');
      }
    });

    it('detects Egyptian Arabic explicit requests', () => {
      const cases = [
        'كلمني مصري',
        'اتكلم بالمصري',
        'كلمني بالعامية المصرية',
        'بالمصري لو سمحت',
        'Speak Egyptian',
        'Speak Egyptian Arabic',
      ];

      for (const phrase of cases) {
        const result = service.resolveContext(phrase);
        expect(result.targetLanguage).toBe('ar');
        expect(result.dialect).toBe('egyptian');
        expect(result.source).toBe('explicit_instruction');
        expect(result.locale).toBe('ar-EG');
        expect(result.textDirection).toBe('rtl');
      }
    });

    it('detects Modern Standard Arabic (MSA) explicit requests', () => {
      const cases = [
        'كلمني فصحى',
        'العربية الفصحى',
        'اتكلم عربي فصيح',
        'باللغة العربية الفصحى',
        'Speak MSA',
        'Speak Standard Arabic',
      ];

      for (const phrase of cases) {
        const result = service.resolveContext(phrase);
        expect(result.targetLanguage).toBe('ar');
        expect(result.dialect).toBe('msa');
        expect(result.source).toBe('explicit_instruction');
        expect(result.locale).toBe('ar');
        expect(result.textDirection).toBe('rtl');
      }
    });

    it('detects Gulf and Levantine Arabic explicit requests', () => {
      const gulf = service.resolveContext('كلمني خليجي');
      expect(gulf.targetLanguage).toBe('ar');
      expect(gulf.dialect).toBe('gulf');
      expect(gulf.source).toBe('explicit_instruction');
      expect(gulf.locale).toBe('ar-SA');

      const lev = service.resolveContext('كلمني شامي');
      expect(lev.targetLanguage).toBe('ar');
      expect(lev.dialect).toBe('levantine');
      expect(lev.source).toBe('explicit_instruction');
      expect(lev.locale).toBe('ar-LB');
    });

    it('detects French, German, and Spanish explicit requests', () => {
      const fr = service.resolveContext('كلمني فرنساوي');
      expect(fr.targetLanguage).toBe('fr');
      expect(fr.source).toBe('explicit_instruction');

      const fr2 = service.resolveContext('Parle français');
      expect(fr2.targetLanguage).toBe('fr');
      expect(fr2.source).toBe('explicit_instruction');

      const de = service.resolveContext('Speak German');
      expect(de.targetLanguage).toBe('de');
      expect(de.source).toBe('explicit_instruction');

      const es = service.resolveContext('Habla español');
      expect(es.targetLanguage).toBe('es');
      expect(es.source).toBe('explicit_instruction');
    });

    it('distinguishes temporary (turn-only) vs persistent scope', () => {
      const turnOnly = service.resolveContext('كلمني بالإنجليزي في الرسالة دي بس');
      expect(turnOnly.targetLanguage).toBe('en');
      expect(turnOnly.explicitInstruction?.scope).toBe('turn');

      const turnOnlyEn = service.resolveContext('Just for this message speak English');
      expect(turnOnlyEn.targetLanguage).toBe('en');
      expect(turnOnlyEn.explicitInstruction?.scope).toBe('turn');

      const persistent = service.resolveContext('كلمني بالإنجليزي');
      expect(persistent.targetLanguage).toBe('en');
      expect(persistent.explicitInstruction?.scope).toBe('persistent');
    });
  });

  // ===========================================================================
  // 2. Current Message Detection
  // ===========================================================================
  describe('Tier 2: Current Message Detection', () => {
    it('detects standard English messages accurately', () => {
      const result = service.resolveContext('How are you doing today?');
      expect(result.targetLanguage).toBe('en');
      expect(result.source).toBe('current_message');
      expect(result.confidence).toBeGreaterThanOrEqual(0.7);
      expect(result.locale).toBe('en-US');
      expect(result.textDirection).toBe('ltr');
    });

    it('detects standard Arabic messages and infers dialect when available', () => {
      const egShort = service.resolveContext('عامل إيه؟');
      expect(egShort.targetLanguage).toBe('ar');
      expect(egShort.dialect).toBe('egyptian');
      expect(egShort.source).toBe('current_message');

      const eg = service.resolveContext('عامل إيه يا باشا فينك من الصبح؟');
      expect(eg.targetLanguage).toBe('ar');
      expect(eg.dialect).toBe('egyptian');
      expect(eg.source).toBe('current_message');
      expect(eg.locale).toBe('ar-EG');
      expect(eg.textDirection).toBe('rtl');

      const lev = service.resolveContext('كيفك شو الأخبار اليوم؟');
      expect(lev.targetLanguage).toBe('ar');
      expect(lev.dialect).toBe('levantine');
      expect(lev.source).toBe('current_message');
      expect(lev.locale).toBe('ar-LB');

      const gulf = service.resolveContext('شلونك يا الغالي عساك بخير؟');
      expect(gulf.targetLanguage).toBe('ar');
      expect(gulf.dialect).toBe('gulf');
      expect(gulf.source).toBe('current_message');
      expect(gulf.locale).toBe('ar-SA');
    });

    it('detects French, German, and Spanish messages', () => {
      const frShort = service.resolveContext('Bonjour');
      expect(frShort.targetLanguage).toBe('fr');
      expect(frShort.source).toBe('current_message');

      const fr = service.resolveContext('Bonjour, comment allez-vous aujourd hui?');
      expect(fr.targetLanguage).toBe('fr');
      expect(fr.source).toBe('current_message');

      const de = service.resolveContext('Guten Morgen, wie kann ich dir helfen?');
      expect(de.targetLanguage).toBe('de');
      expect(de.source).toBe('current_message');

      const es = service.resolveContext('Hola, buenos días, cómo estás?');
      expect(es.targetLanguage).toBe('es');
      expect(es.source).toBe('current_message');
    });
  });

  // ===========================================================================
  // 3. Stored Preference Override (Crucial Requirement)
  // ===========================================================================
  describe('Tier 5 vs Tier 2: Stored Preference MUST NEVER override current message', () => {
    it('resolves to English when current message is English even if stored preference is Egyptian Arabic', () => {
      const result = service.resolveContext('Can you explain Flutter Bloc state management?', {
        storedPreference: {
          language: 'ar',
          dialect: 'egyptian',
        },
      });

      expect(result.targetLanguage).toBe('en');
      expect(result.source).toBe('current_message');
      expect(result.locale).toBe('en-US');
    });

    it('resolves to Arabic when current message is Arabic even if stored preference is English', () => {
      const result = service.resolveContext('ممكن توضحلي إزاي أربط الـ Supabase بالكود؟', {
        storedPreference: {
          language: 'en',
        },
      });

      expect(result.targetLanguage).toBe('ar');
      expect(result.source).toBe('current_message');
      expect(result.textDirection).toBe('rtl');
    });

    it('uses stored preference when current message is empty or purely symbolic', () => {
      const result = service.resolveContext('??? 12345 !!!', {
        storedPreference: {
          language: 'ar',
          dialect: 'egyptian',
        },
      });

      expect(result.targetLanguage).toBe('ar');
      expect(result.dialect).toBe('egyptian');
      expect(result.source).toBe('stored_preference');
    });
  });

  // ===========================================================================
  // 4. Short Messages and Recent History
  // ===========================================================================
  describe('Tier 3: Short Messages & Recent History Stabilization', () => {
    it('does not aggressively switch language on short neutral tokens when recent history is English', () => {
      const shortTokens = ['ok', 'yes', 'thanks', 'cool', 'why?'];

      for (const token of shortTokens) {
        const result = service.resolveContext(token, {
          recentMessages: [
            'Hello! How can I assist you today?',
            'Can you tell me about the subscription plans?',
          ],
        });

        expect(result.targetLanguage).toBe('en');
        expect(result.source).toBe('recent_history');
      }
    });

    it('preserves Arabic when user sends short Arabic neutral tokens with Arabic history', () => {
      const shortTokens = ['تمام', 'ماشي', 'شكراً', 'حبيبي', 'ليه؟'];

      for (const token of shortTokens) {
        const result = service.resolveContext(token, {
          recentMessages: [
            'أهلاً بك يا فندم! كيف يمكنني مساعدتك اليوم؟',
            'عاوز أعرف أسعار الباقات المتاحة',
          ],
        });

        expect(result.targetLanguage).toBe('ar');
        expect(result.source).toBe('recent_history');
      }
    });

    it('uses conversationLanguage state when recent history is empty for short tokens', () => {
      const result = service.resolveContext('ok', {
        conversationLanguage: 'en',
      });

      expect(result.targetLanguage).toBe('en');
      expect(result.source).toBe('conversation_state');
    });

    it('evaluates standalone short greetings naturally when no prior context exists', () => {
      const enHi = service.resolveContext('hi');
      expect(enHi.targetLanguage).toBe('en');

      const arTamam = service.resolveContext('تمام');
      expect(arTamam.targetLanguage).toBe('ar');
    });
  });

  // ===========================================================================
  // 5. Mixed Language and Code-Switching
  // ===========================================================================
  describe('Mixed Language & Code-Switching Scenarios', () => {
    it('resolves Arabic when carrier language and grammar are Arabic despite English tech terms', () => {
      const cases = [
        'أنا محتاج help في Flutter',
        'ممكن شرح للـ state management في React؟',
        'عندي error في الـ build بتاع التطبيق',
      ];

      for (const text of cases) {
        const result = service.resolveContext(text);
        expect(result.targetLanguage).toBe('ar');
        expect(result.source).toBe('current_message');
      }
    });

    it('resolves English when carrier language and grammar are English despite Arabic loan words', () => {
      const cases = [
        'what is أفضل way to handle state management?',
        'I need مساعدة with Supabase',
        'Can you explain the problem to me ya habibi?',
        'Can you explainلي المشكلة؟',
      ];

      for (const text of cases) {
        const result = service.resolveContext(text);
        expect(result.targetLanguage).toBe('en');
        expect(result.source).toBe('current_message');
      }
    });

    it('breaks tie using recent history when mixed message confidence is borderline', () => {
      const result = service.resolveContext('help مساعدة', {
        recentMessages: [
          'We need to fix the deployment pipeline.',
          'Can you check the logs for errors?',
        ],
      });

      expect(result.targetLanguage).toBe('en');
      expect(result.source).toBe('recent_history');
    });
  });

  // ===========================================================================
  // 6. Neutral Fallback (Tier 6)
  // ===========================================================================
  describe('Tier 6: Neutral Fallback', () => {
    it('falls back to unbiased Standard Arabic (NOT Egyptian) when no language signals exist', () => {
      const result = service.resolveContext('??? :) 12345');

      expect(result.targetLanguage).toBe('ar');
      expect(result.dialect).toBeUndefined(); // MUST NOT BE 'egyptian'
      expect(result.locale).toBe('ar');      // MUST NOT BE 'ar-EG'
      expect(result.source).toBe('neutral_fallback');
      expect(result.confidence).toBe(0.5);
      expect(result.textDirection).toBe('rtl');
    });

    it('respects custom defaultFallback if provided in options', () => {
      const result = service.resolveContext('', {
        defaultFallback: {
          language: 'en',
        },
      });

      expect(result.targetLanguage).toBe('en');
      expect(result.locale).toBe('en-US');
      expect(result.source).toBe('neutral_fallback');
    });
  });
});
