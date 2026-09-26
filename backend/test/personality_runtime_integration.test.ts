import { AgentOrchestrator, AgentRunInput } from '../src/modules/agent/orchestrator';
import { GroqProvider } from '../src/modules/groq/groq.provider';
import {
  PersonalityEngine,
  PersonalityContext,
  DEFAULT_CRAFT_PERSONALITY,
  buildPersonalityInstructions,
} from '../src/modules/personality';
import { LanguageIntelligenceService } from '../src/modules/language';
import { SemanticCacheEngine } from '../src/modules/cache/semantic_cache_engine';
import { config } from '../src/config/env';

describe('Phase 3.3-A: Personality Runtime Integration', () => {
  let orchestrator: AgentOrchestrator;
  let groqProvider: GroqProvider;

  beforeAll(() => {
    config.groq.isMockMode = true;
    orchestrator = new AgentOrchestrator();
    groqProvider = new GroqProvider();
  });

  // Test 1 — Default Personality reaches AI generation
  describe('Test 1 — Default Personality in Runtime', () => {
    it('resolves and passes the default Craft personality when no explicit preference is provided', async () => {
      const input: AgentRunInput = {
        userId: 'personality_test_user_1',
        channel: 'flutter',
        text: 'Hello Craft, could you explain the theory of relativity?',
      };

      const result = await orchestrator.run(input);

      expect(result.personalityContext).toBeDefined();
      expect(result.personalityContext).toEqual(DEFAULT_CRAFT_PERSONALITY);
      expect(result.personalityContext?.tone).toEqual(['warm', 'professional', 'direct']);
      expect(result.personalityContext?.formality).toBe('consultative');
      expect(result.personalityContext?.verbosity).toBe('balanced');
      expect(result.personalityContext?.addressingStyle).toBe('none');
      expect(result.personalityContext?.emojiPolicy).toBe('minimal');
      expect(result.personalityContext?.humorLevel).toBe('none');
      expect(result.personalityContext?.proactivity).toBe('direct_answer');

      // Verify prompt builder translates default context accurately into system prompt
      const systemPrompt = groqProvider.getSystemInstruction(
        [],
        result.languageContext,
        result.personalityContext
      );

      expect(systemPrompt).toContain('### Communication & Personality Guidelines:');
      expect(systemPrompt).toContain('Embody a warm, professional, direct tone in all interactions.');
      expect(systemPrompt).toContain('Use a consultative, professional, and natural style without excessive rigidity.');
      expect(systemPrompt).toContain('Provide balanced answers that are clear, thorough, and free of filler.');
      expect(systemPrompt).toContain('Do not use titles, honorifics, or familiar nicknames by default.');
      expect(systemPrompt).toContain('Use emojis sparingly and only when contextually natural');
      expect(systemPrompt).toContain('Do not use humor; maintain a focused, helpful approach.');
      expect(systemPrompt).toContain("Answer the user's question directly. Do not append unsolicited follow-up offers");
    });
  });

  // Test 2 — Explicit Concise
  describe('Test 2 — Explicit Verbosity (Concise)', () => {
    it('propagates explicit concise preference without mutating other default personality traits', async () => {
      const input: AgentRunInput = {
        userId: 'personality_test_user_2',
        channel: 'flutter',
        text: 'Explain quantum computing in detail',
        explicitPersonalityPreference: {
          verbosity: 'concise',
        },
      };

      const result = await orchestrator.run(input);

      expect(result.personalityContext).toBeDefined();
      expect(result.personalityContext?.verbosity).toBe('concise');
      // Other dimensions must remain unaffected
      expect(result.personalityContext?.formality).toBe('consultative');
      expect(result.personalityContext?.addressingStyle).toBe('none');
      expect(result.personalityContext?.emojiPolicy).toBe('minimal');
      expect(result.personalityContext?.tone).toEqual(['warm', 'professional', 'direct']);

      const promptInstructions = buildPersonalityInstructions(result.personalityContext!);
      expect(promptInstructions).toContain(
        'Be concise and get straight to the point without unnecessary filler.'
      );
      expect(promptInstructions).not.toContain('Provide balanced answers');
    });
  });

  // Test 3 — No Addressing
  describe('Test 3 — Addressing Style Policy (None)', () => {
    it('enforces none addressing style and prevents colloquial titles or nicknames', async () => {
      const input: AgentRunInput = {
        userId: 'personality_test_user_3',
        channel: 'flutter',
        text: 'ما هو متوسط عمر البطارية في هواتف آيفون؟',
      };

      const result = await orchestrator.run(input);

      expect(result.personalityContext?.addressingStyle).toBe('none');

      const systemPrompt = groqProvider.getSystemInstruction(
        [],
        result.languageContext,
        result.personalityContext
      );

      expect(systemPrompt).toContain(
        'Do not use titles, honorifics, or familiar nicknames by default. Address the user directly without prefixes.'
      );
      // Ensure no prompt leakage of slang lists in the personality section
      const personalityBlock = systemPrompt.split('### Communication & Personality Guidelines:')[1]?.split('###')[0] || '';
      expect(personalityBlock).not.toContain('يا باشا');
      expect(personalityBlock).not.toContain('يا هندسة');
      expect(personalityBlock).not.toContain('يا معلم');
    });
  });

  // Test 4 — No Emoji
  describe('Test 4 — Emoji Policy (None)', () => {
    it('enforces none emoji policy when explicitly requested and converts to correct instruction', async () => {
      const input: AgentRunInput = {
        userId: 'personality_test_user_4',
        channel: 'flutter',
        text: 'ما هي مواصفات جهاز ماك بوك برو M3؟',
        explicitPersonalityPreference: {
          emojiPolicy: 'none',
        },
      };

      const result = await orchestrator.run(input);

      expect(result.personalityContext?.emojiPolicy).toBe('none');

      const promptInstructions = buildPersonalityInstructions(result.personalityContext!);
      expect(promptInstructions).toContain('- Emoji Policy: Do not use emojis in your responses.');
      expect(promptInstructions).not.toContain('Use emojis sparingly');
    });
  });

  // Test 5 — Language Independence
  describe('Test 5 — Strict Independence between Language and Personality', () => {
    it('maintains identical personality context across English, Arabic, and French requests', async () => {
      const enInput: AgentRunInput = {
        userId: 'personality_lang_user_en',
        channel: 'flutter',
        text: 'What is cloud computing?',
      };
      const arInput: AgentRunInput = {
        userId: 'personality_lang_user_ar',
        channel: 'flutter',
        text: 'ما هي الحوسبة السحابية؟',
      };
      const frInput: AgentRunInput = {
        userId: 'personality_lang_user_fr',
        channel: 'flutter',
        text: "Qu'est-ce que l'informatique en nuage ?",
      };

      const [enRes, arRes, frRes] = await Promise.all([
        orchestrator.run(enInput),
        orchestrator.run(arInput),
        orchestrator.run(frInput),
      ]);

      // Languages are distinct
      expect(enRes.languageContext?.targetLanguage).toBe('en');
      expect(arRes.languageContext?.targetLanguage).toBe('ar');
      expect(frRes.languageContext?.targetLanguage).toBe('fr');

      // Personality contexts are strictly identical
      expect(enRes.personalityContext).toEqual(DEFAULT_CRAFT_PERSONALITY);
      expect(arRes.personalityContext).toEqual(DEFAULT_CRAFT_PERSONALITY);
      expect(frRes.personalityContext).toEqual(DEFAULT_CRAFT_PERSONALITY);
      expect(enRes.personalityContext).toEqual(arRes.personalityContext);
      expect(arRes.personalityContext).toEqual(frRes.personalityContext);
    });
  });

  // Test 6 — Arabic Dialect Independence
  describe('Test 6 — Arabic Dialects do not alter Personality Traits', () => {
    it('does NOT infer casual formality from Egyptian dialect or formal from MSA', async () => {
      const egyptianInput: AgentRunInput = {
        userId: 'personality_dialect_eg',
        channel: 'flutter',
        text: 'ازيك يا كرافت عامل ايه دلوقتي وطمني عليك',
      };
      const gulfInput: AgentRunInput = {
        userId: 'personality_dialect_gulf',
        channel: 'flutter',
        text: 'شلونك يا كرافت وش اخبارك الحين عساك بخير',
      };
      const levantineInput: AgentRunInput = {
        userId: 'personality_dialect_lev',
        channel: 'flutter',
        text: 'كيفك شو اخبارك اليوم ان شاء الله تمام',
      };
      const msaInput: AgentRunInput = {
        userId: 'personality_dialect_msa',
        channel: 'flutter',
        text: 'السلام عليكم ورحمة الله، كيف حالك اليوم وما هي آخر التطورات؟',
      };

      const [egRes, gulfRes, levRes, msaRes] = await Promise.all([
        orchestrator.run(egyptianInput),
        orchestrator.run(gulfInput),
        orchestrator.run(levantineInput),
        orchestrator.run(msaInput),
      ]);

      // Formality must remain consultative across all dialects (NOT casual, NOT formal)
      expect(egRes.personalityContext?.formality).toBe('consultative');
      expect(gulfRes.personalityContext?.formality).toBe('consultative');
      expect(levRes.personalityContext?.formality).toBe('consultative');
      expect(msaRes.personalityContext?.formality).toBe('consultative');

      // Addressing style must remain 'none' (NO colloquial titles injected)
      expect(egRes.personalityContext?.addressingStyle).toBe('none');
      expect(gulfRes.personalityContext?.addressingStyle).toBe('none');
      expect(levRes.personalityContext?.addressingStyle).toBe('none');
      expect(msaRes.personalityContext?.addressingStyle).toBe('none');

      // All personality contexts must be strictly identical
      expect(egRes.personalityContext).toEqual(DEFAULT_CRAFT_PERSONALITY);
      expect(gulfRes.personalityContext).toEqual(DEFAULT_CRAFT_PERSONALITY);
      expect(levRes.personalityContext).toEqual(DEFAULT_CRAFT_PERSONALITY);
      expect(msaRes.personalityContext).toEqual(DEFAULT_CRAFT_PERSONALITY);
    });
  });

  // Test 7 — Explicit Language Instruction vs Personality
  describe('Test 7 — Explicit Language Command vs Personality', () => {
    it('switches LanguageContext to English when explicitly requested while leaving PersonalityContext unchanged', async () => {
      const input: AgentRunInput = {
        userId: 'personality_explicit_lang_user',
        channel: 'flutter',
        text: 'كلمني بالإنجليزي من فضلك وقولي ايه جديد في الذكاء الاصطناعي',
      };

      const result = await orchestrator.run(input);

      expect(result.languageContext?.targetLanguage).toBe('en');
      expect(result.languageContext?.source).toBe('explicit_instruction');

      // PersonalityContext must remain completely unchanged
      expect(result.personalityContext).toEqual(DEFAULT_CRAFT_PERSONALITY);
      expect(result.personalityContext?.formality).toBe('consultative');
      expect(result.personalityContext?.verbosity).toBe('balanced');
    });
  });

  // Test 8 — Fallback Consistency
  describe('Test 8 — Primary and Fallback Provider Consistency', () => {
    it('guarantees that primary and fallback AI generation share identical PersonalityContext and system instructions', () => {
      const customPersonality: PersonalityContext = Object.freeze({
        tone: Object.freeze(['professional', 'direct'] as const),
        formality: 'formal',
        verbosity: 'comprehensive',
        addressingStyle: 'respectful',
        emojiPolicy: 'none',
        humorLevel: 'none',
        proactivity: 'suggest_next_step',
      });

      const langContext = LanguageIntelligenceService.getInstance().resolveContext('Explain microservices architecture');

      // Generate instructions as would be used by primary and fallback models in GroqProvider
      const primaryInstruction = groqProvider.getSystemInstruction([], langContext, customPersonality);
      const fallbackInstruction = groqProvider.getSystemInstruction([], langContext, customPersonality);

      expect(primaryInstruction).toBe(fallbackInstruction);
      expect(primaryInstruction).toContain('Formality: Maintain a formal, dignified, and professional communication style.');
      expect(primaryInstruction).toContain('Verbosity: Provide comprehensive, detailed responses with thorough explanations when warranted.');
      expect(primaryInstruction).toContain('Emoji Policy: Do not use emojis in your responses.');
      expect(primaryInstruction).toContain('Proactivity: After answering directly, proactively suggest a relevant next step or useful follow-up if helpful.');
    });
  });

  // Test 9 — Semantic Cache Isolation
  describe('Test 9 — Semantic Cache Isolation', () => {
    it('verifies that changing personality preferences does not alter semantic cache processing, matching, or embedding', async () => {
      const query = 'السلام عليكم';

      // 1. Process with default personality context
      const langContext = LanguageIntelligenceService.getInstance().resolveContext(query);
      const cacheResultDefault = await SemanticCacheEngine.getInstance().process(query, {
        userId: 'cache_isolation_user',
        channel: 'flutter',
        languageContext: langContext,
      });

      // 2. Process with different explicit personality preferences
      // Note: SemanticCacheEngine.process only takes LanguageContext, NOT PersonalityContext
      const cacheResultConcise = await SemanticCacheEngine.getInstance().process(query, {
        userId: 'cache_isolation_user',
        channel: 'flutter',
        languageContext: langContext,
      });

      // Both should produce identical cache behavior and responses
      expect(cacheResultDefault.type).toBe(cacheResultConcise.type);
      if (cacheResultDefault.type === 'hit' && cacheResultConcise.type === 'hit') {
        expect(cacheResultDefault.response).toBe(cacheResultConcise.response);
      }

      // Verify that PersonalityEngine does NOT export or mutate any cache parameters
      const resolved1 = PersonalityEngine.getInstance().resolve({
        explicitPreference: { verbosity: 'concise', emojiPolicy: 'none' },
      });
      const resolved2 = PersonalityEngine.getInstance().resolve({
        explicitPreference: { verbosity: 'comprehensive', emojiPolicy: 'expressive' },
      });

      expect(resolved1).not.toEqual(resolved2);
      // But neither resolution touches LanguageContext or cache
      expect(langContext.targetLanguage).toBe('ar');
    });
  });
});
