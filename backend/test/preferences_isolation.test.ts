import { UserPreferenceRepository } from '../src/database/repositories/user_preference.repo';
import { MemoryRepository } from '../src/database/repositories/memory.repo';
import { AgentOrchestrator } from '../src/modules/agent/orchestrator';
import { DEFAULT_CRAFT_PERSONALITY } from '../src/modules/personality/types';
import { LanguagePreference, PersonalityPreference } from '../src/modules/memory/types';

describe('Phase 4.3: Language & Personality Preferences Isolation', () => {
  let userPrefRepo: UserPreferenceRepository;
  let memoryRepo: MemoryRepository;
  let orchestrator: AgentOrchestrator;

  beforeEach(() => {
    userPrefRepo = new UserPreferenceRepository();
    memoryRepo = new MemoryRepository();
    orchestrator = new AgentOrchestrator(
      undefined,
      undefined,
      undefined,
      undefined,
      memoryRepo,
      undefined,
      userPrefRepo
    );
  });

  describe('UserPreferenceRepository operations', () => {
    it('1, 2, 3: saves, retrieves, and updates LanguagePreference', async () => {
      const testUserId = 'test_user_pref_repo_' + Date.now();

      // 1. Save
      const initialPref: LanguagePreference = {
        language: 'ar',
        dialect: 'egyptian',
        script: 'arabic',
      };
      await userPrefRepo.setLanguagePreference(testUserId, initialPref);

      // 2. Retrieve
      const retrieved = await userPrefRepo.getLanguagePreference(testUserId);
      expect(retrieved).toBeDefined();
      expect(retrieved?.language).toBe('ar');
      expect(retrieved?.dialect).toBe('egyptian');

      // 3. Update
      const updatedPref: LanguagePreference = {
        language: 'en',
      };
      await userPrefRepo.setLanguagePreference(testUserId, updatedPref);
      const retrievedUpdated = await userPrefRepo.getLanguagePreference(testUserId);
      expect(retrievedUpdated?.language).toBe('en');
      expect(retrievedUpdated?.dialect).toBeUndefined();
    });

    it('4, 5, 6: saves, retrieves, and updates PersonalityPreference', async () => {
      const testUserId = 'test_user_pref_pers_' + Date.now();

      // 4. Save
      const initialPers: PersonalityPreference = {
        formality: 'formal',
        verbosity: 'concise',
        tone: ['direct'],
      };
      await userPrefRepo.setPersonalityPreference(testUserId, initialPers);

      // 5. Retrieve
      const retrieved = await userPrefRepo.getPersonalityPreference(testUserId);
      expect(retrieved).toBeDefined();
      expect(retrieved?.formality).toBe('formal');
      expect(retrieved?.verbosity).toBe('concise');
      expect(retrieved?.tone).toContain('direct');

      // 6. Update
      const updatedPers: PersonalityPreference = {
        formality: 'casual',
        verbosity: 'comprehensive',
        emojiPolicy: 'expressive',
      };
      await userPrefRepo.setPersonalityPreference(testUserId, updatedPers);
      const retrievedUpdated = await userPrefRepo.getPersonalityPreference(testUserId);
      expect(retrievedUpdated?.formality).toBe('casual');
      expect(retrievedUpdated?.verbosity).toBe('comprehensive');
      expect(retrievedUpdated?.emojiPolicy).toBe('expressive');
    });

    it('7: enforces single preference per key for a user (uniqueness/replacement)', async () => {
      const testUserId = 'test_user_pref_uniq_' + Date.now();
      await userPrefRepo.setPreference(testUserId, 'language', { language: 'fr' });
      await userPrefRepo.setPreference(testUserId, 'language', { language: 'de' });

      const finalPref = await userPrefRepo.getPreference<{ language: string }>(testUserId, 'language');
      expect(finalPref?.language).toBe('de');
    });
  });

  describe('Runtime isolation: Generic memory facts MUST NOT pollute LanguageContext', () => {
    it('8 & 9: "المستخدم يعمل في شركة مصرية" does NOT force Egyptian Arabic', async () => {
      const userIdEgyptianCompany = 'user_fact_egypt_co_' + Date.now();
      // Save factual memory mentioning "مصرية"
      await memoryRepo.saveFact(userIdEgyptianCompany, 'المستخدم يعمل في شركة مصرية ناشئة', 'stable_fact');

      // Send a neutral message with no dialect signal
      const result = await orchestrator.run({
        userId: userIdEgyptianCompany,
        channel: 'whatsapp',
        text: 'ما هي عاصمة فرنسا؟',
      });

      expect(result.status).toBe('completed');
      expect(result.languageContext).toBeDefined();
      // Should NOT infer Egyptian dialect because of the word "مصرية" in the memory fact
      expect(result.languageContext?.dialect).toBeUndefined();
      expect(result.languageContext?.targetLanguage).toBe('ar');
    });

    it('10: "المستخدم مهتم بالتاريخ المصري" does NOT force Egyptian Arabic', async () => {
      const userIdEgyptianHistory = 'user_fact_egypt_history_' + Date.now();
      await memoryRepo.saveFact(userIdEgyptianHistory, 'المستخدم مهتم بالتاريخ المصري القديم', 'interests');

      const result = await orchestrator.run({
        userId: userIdEgyptianHistory,
        channel: 'whatsapp',
        text: 'هل يمكنك تلخيص هذا المقال لي؟',
      });

      expect(result.status).toBe('completed');
      expect(result.languageContext?.dialect).toBeUndefined();
      expect(result.languageContext?.targetLanguage).toBe('ar');
    });
  });

  describe('Stored Language Preference behavior in Orchestrator', () => {
    it('11: stored Arabic/Egyptian preference is applied when current message is neutral/short', async () => {
      const userId11 = 'user_stored_ar_pref_11_' + Date.now();
      await userPrefRepo.setLanguagePreference(userId11, {
        language: 'ar',
        dialect: 'egyptian',
      });

      const result = await orchestrator.run({
        userId: userId11,
        channel: 'whatsapp',
        text: 'تمام',
      });

      expect(result.status).toBe('completed');
      expect(result.languageContext?.targetLanguage).toBe('ar');
      expect(result.languageContext?.dialect).toBe('egyptian');
      expect(result.languageContext?.source).toBe('stored_preference');
    });

    it('12: current English request overrides stored Arabic preference (Tier 1/2 > Tier 5)', async () => {
      const userId12 = 'user_stored_ar_pref_12_' + Date.now();
      await userPrefRepo.setLanguagePreference(userId12, {
        language: 'ar',
        dialect: 'egyptian',
      });

      const result = await orchestrator.run({
        userId: userId12,
        channel: 'whatsapp',
        text: 'Please answer me in English for this question.',
      });

      expect(result.status).toBe('completed');
      expect(result.languageContext?.targetLanguage).toBe('en');
    });
  });

  describe('Stored Personality Preference behavior in Orchestrator', () => {
    it('13: user without PersonalityPreference uses DEFAULT_CRAFT_PERSONALITY', async () => {
      const userDefault = 'user_pers_default_' + Date.now();
      const result = await orchestrator.run({
        userId: userDefault,
        channel: 'whatsapp',
        text: 'مرحبا، كيف حالك؟',
      });

      expect(result.status).toBe('completed');
      expect(result.personalityContext).toBeDefined();
      expect(result.personalityContext?.formality).toBe(DEFAULT_CRAFT_PERSONALITY.formality);
      expect(result.personalityContext?.verbosity).toBe(DEFAULT_CRAFT_PERSONALITY.verbosity);
      expect(result.personalityContext?.emojiPolicy).toBe(DEFAULT_CRAFT_PERSONALITY.emojiPolicy);
    });

    it('14: user with PersonalityPreference applies preference without altering language', async () => {
      const userWithPersPref = 'user_pers_custom_' + Date.now();
      await userPrefRepo.setPersonalityPreference(userWithPersPref, {
        formality: 'formal',
        verbosity: 'concise',
        emojiPolicy: 'none',
      });

      const result = await orchestrator.run({
        userId: userWithPersPref,
        channel: 'whatsapp',
        text: 'اشرح لي ماهية الحوسبة السحابية',
      });

      expect(result.status).toBe('completed');
      expect(result.personalityContext?.formality).toBe('formal');
      expect(result.personalityContext?.verbosity).toBe('concise');
      expect(result.personalityContext?.emojiPolicy).toBe('none');
      // Language remains determined strictly by Language Intelligence (Modern Standard Arabic in this case)
      expect(result.languageContext?.targetLanguage).toBe('ar');
      expect(result.languageContext?.dialect).toBeUndefined();
    });
  });
});
