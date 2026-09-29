/**
 * Production UX Hardening Verification Suite
 * 
 * Verifies the 3 UX Hardening fixes from real WhatsApp testing:
 * 1. Egyptian Dialect Conversational Continuity across multi-turn follow-ups
 * 2. Ambiguous "اعملها" Clarification Gate & Anti-Hallucination Guardrails
 * 3. Raw Google News Redirect URL Suppression & Clean Domain Fallback Presentation
 */

import { LanguageIntelligenceService } from '../src/modules/language/language_intelligence.service';
import { DialectDetector } from '../src/modules/language/dialect_detector';
import { ExplicitInstructionDetector } from '../src/modules/language/explicit_instruction_detector';
import { ClarificationGate } from '../src/modules/response/clarification_gate';
import { SearchFallbackFormatter } from '../src/modules/tools/adapters/search_fallback_formatter';
import { ToolResultFormatter } from '../src/modules/tools/adapters/tool_result_formatter';
import { SystemPromptBuilder } from '../src/modules/ai/prompts/system_prompt';
import { AdaptiveResponseEngine } from '../src/modules/response/response_engine';
import { GroqProvider } from '../src/modules/groq/groq.provider';
import { config } from '../src/config/env';

describe('Production UX Hardening: Real WhatsApp Testing Fixes', () => {
  const languageService = LanguageIntelligenceService.getInstance();

  beforeAll(() => {
    config.groq.isMockMode = true;
  });

  // =========================================================================
  // 1. Bug 1: Egyptian Dialect Multi-Turn Conversational Continuity
  // =========================================================================
  describe('Bug 1: Egyptian Dialect Conversational Continuity', () => {
    it('1.1: Single-turn Egyptian markers are detected reliably', () => {
      const markers = [
        'بص فهمني يعني إيه dependency injection',
        'قارنلي بين Bloc و Riverpod',
        'وريني كود عملي',
        'هاتلي الفرق بينهم',
        'اختصرهولي في 3 نقاط',
        'لخصهولي لو سمحت',
        'فهمهالي براحة',
        'انهي واحد انسب للبروجكت بتاعي؟',
        'بتفرق في الـ performance ولا لأ؟',
      ];

      for (const text of markers) {
        const signal = DialectDetector.detect(text);
        expect(signal.dialect).toBe('egyptian');
        expect(signal.confidence).toBeGreaterThanOrEqual(0.65);
      }
    });

    it('1.2: Multi-turn Egyptian conversation persists across short follow-ups', () => {
      // Turn 1: High-confidence Egyptian user question
      const turn1Context = languageService.resolveContext(
        'بص فهمني يعني إيه dependency injection'
      );
      expect(turn1Context.targetLanguage).toBe('ar');
      expect(turn1Context.dialect).toBe('egyptian');
      expect(turn1Context.locale).toBe('ar-EG');

      // Turn 2: Technical follow-up comparing frameworks
      const turn2Context = languageService.resolveContext(
        'قارنلي بين Bloc و Riverpod',
        {
          recentMessages: [
            { role: 'user', text: 'بص فهمني يعني إيه dependency injection' },
            { role: 'assistant', text: 'Dependency Injection هو أسلوب لفصل الاعتماديات في الكود...' },
          ],
        }
      );
      expect(turn2Context.targetLanguage).toBe('ar');
      expect(turn2Context.dialect).toBe('egyptian');
      expect(turn2Context.locale).toBe('ar-EG');

      // Turn 3: Short follow-up without strong local markers, relying on history continuity
      const turn3Context = languageService.resolveContext(
        'طب انهي واحد انسب؟',
        {
          recentMessages: [
            { role: 'user', text: 'بص فهمني يعني إيه dependency injection' },
            { role: 'assistant', text: 'Dependency Injection هو أسلوب لفصل الاعتماديات في الكود...' },
            { role: 'user', text: 'قارنلي بين Bloc و Riverpod' },
            { role: 'assistant', text: 'Bloc مناسب للتطبيقات الكبيرة وRiverpod ممتاز للمرونة...' },
          ],
        }
      );
      expect(turn3Context.targetLanguage).toBe('ar');
      expect(turn3Context.dialect).toBe('egyptian');
      expect(turn3Context.locale).toBe('ar-EG');

      // Turn 4: Conciseness request follow-up
      const turn4Context = languageService.resolveContext(
        'اختصرهولي في 3 نقاط',
        {
          recentMessages: [
            { role: 'user', text: 'بص فهمني يعني إيه dependency injection' },
            { role: 'assistant', text: '...' },
            { role: 'user', text: 'قارنلي بين Bloc و Riverpod' },
            { role: 'assistant', text: '...' },
            { role: 'user', text: 'طب انهي واحد انسب؟' },
            { role: 'assistant', text: '...' },
          ],
        }
      );
      expect(turn4Context.targetLanguage).toBe('ar');
      expect(turn4Context.dialect).toBe('egyptian');
      expect(turn4Context.locale).toBe('ar-EG');
      expect(turn4Context.verbosity).toBe('concise');
    });

    it('1.3: Explicit override to English and return to Egyptian works seamlessly', () => {
      // Step A: Explicit command to switch to English
      const enContext = languageService.resolveContext('Answer in formal English');
      expect(enContext.targetLanguage).toBe('en');
      expect(enContext.register).toBe('formal');
      expect(enContext.locale).toBe('en-US');
      expect(enContext.source).toBe('explicit_instruction');

      // Step B: Explicit command to return to Egyptian Arabic
      const returnContext = languageService.resolveContext('ارجع كلمني بالمصري', {
        recentMessages: [
          { role: 'user', text: 'Answer in formal English' },
          { role: 'assistant', text: 'Certainly, I will communicate in formal English.' },
        ],
      });
      expect(returnContext.targetLanguage).toBe('ar');
      expect(returnContext.dialect).toBe('egyptian');
      expect(returnContext.locale).toBe('ar-EG');
      expect(returnContext.source).toBe('explicit_instruction');

      // Step C: Other return variations
      const variations = ['ارجع للمصري', 'خلينا بالمصري', 'switch back to egyptian'];
      for (const phrase of variations) {
        const detected = ExplicitInstructionDetector.detect(phrase);
        expect(detected.detected).toBe(true);
        expect(detected.requestedLanguage).toBe('ar');
        expect(detected.requestedDialect).toBe('egyptian');
      }
    });

    it('1.4: System prompt strictly prohibits MSA reversion when dialect is Egyptian', () => {
      const prompt = SystemPromptBuilder.buildSystemInstruction([], {
        targetLanguage: 'ar',
        dialect: 'egyptian',
        locale: 'ar-EG',
        textDirection: 'rtl',
        confidence: 0.95,
        source: 'current_message',
      });

      expect(prompt).toContain('STRICT DIALECT PERSISTENCE');
      expect(prompt).toContain('NEVER revert or switch back to Modern Standard Arabic');
      expect(prompt).toContain('Do NOT use artificial or cheesy colloquial slang');
      expect(prompt).toContain('NEVER say "يا باشا", "يا معلم"');
    });
  });

  // =========================================================================
  // 2. Bug 2: Ambiguous "اعملها" Clarification & Anti-Hallucination
  // =========================================================================
  describe('Bug 2: Ambiguous "اعملها" Intent Gate & Clarification', () => {
    const dummyConversationState = {
      isFollowUp: true,
      requiresContext: true,
      contextualizedQuery: 'اعملها (الموضوع السياقي: Flutter Architecture)',
      activeTopic: 'Flutter Architecture',
      goal: 'discuss architecture',
      pendingConfirmation: null,
      messageCount: 3,
    } as any;

    it('2.1: Bare "اعملها" after conceptual discussion triggers clarification gate', () => {
      const recentMessages = [
        { role: 'user', text: 'قارنلي بين Bloc و Riverpod في Flutter' },
        {
          role: 'assistant',
          text: 'Bloc ممتاز للمشاريع الضخمة بسبب الفصل الصارم للحالات، أما Riverpod فيوفر مرونة عالية وتجريد قوي بدون BuildContext.',
        },
      ];

      const bareActions = ['اعملها', 'نفذها', 'كمل', 'اعمل كده', 'نفذ ده', 'do it'];

      for (const query of bareActions) {
        const decision = ClarificationGate.evaluate(
          query,
          dummyConversationState,
          recentMessages as any
        );

        expect(decision.required).toBe(true);
        expect(decision.reason).toBe('ambiguous_referent');
        expect(decision.targetedAspect).toBe('action_intent');
        expect(decision.suggestedClarification).toContain('تقصد أعمل إيه بالظبط؟');
        expect(decision.suggestedOptions).toBeDefined();
        expect(decision.suggestedOptions?.length).toBeGreaterThan(0);
      }
    });

    it('2.2: "اعملها" does NOT trigger clarification if assistant offered a specific actionable task', () => {
      const recentMessages = [
        { role: 'user', text: 'قارنلي بين Bloc و Riverpod' },
        {
          role: 'assistant',
          text: 'هناك فروق جوهرية في إدارة الذاكرة واختبار الوحدات. تحب أعملك جدول مقارنة يلخص كل الفروق؟',
        },
      ];

      const decision = ClarificationGate.evaluate(
        'اعملها',
        dummyConversationState,
        recentMessages as any
      );

      // Grounded in assistant proposal -> proceed directly without clarification interruption
      expect(decision.required).toBe(false);
    });

    it('2.3: ResponseEngine selects clarification_prompt strategy for underspecified actions', () => {
      const responseEngine = AdaptiveResponseEngine.getInstance();
      const policy = responseEngine.analyze({
        query: 'اعملها',
        conversationState: dummyConversationState,
        recentMessages: [
          { role: 'user', text: 'إيه الفرق بين Bloc و Riverpod؟' },
          { role: 'assistant', text: 'Bloc يعتمد على Streams و Events بينما Riverpod يعتمد على Providers.' },
        ] as any,
      });

      expect(policy.strategy).toBe('clarification_prompt');
      expect(policy.structure).toBe('clarification_question');
      expect(policy.instructions.some((i: string) => i.includes('Ask the targeted clarification question'))).toBe(true);
    });

    it('2.4: System prompt contains Anti-Hallucination clause for underspecified actions', () => {
      const prompt = SystemPromptBuilder.buildSystemInstruction();
      expect(prompt).toContain('Intent Integrity & Anti-Hallucination on Ambiguous Actions');
      expect(prompt).toContain('NEVER invent, guess, or hallucinate an extensive unrequested architecture');
      expect(prompt).toContain('Ask a brief, direct clarification question');
    });
  });

  // =========================================================================
  // 3. Bug 3: Raw Google News Redirect URL Suppression
  // =========================================================================
  describe('Bug 3: Google News Redirect URL Suppression', () => {
    it('3.1: isGoogleNewsRedirectUrl correctly identifies redirect tokens', () => {
      const redirectUrls = [
        'https://news.google.com/rss/articles/CBMi1234567890abcdefghijklmnopqrstuvwxyz?oc=5',
        'https://news.google.com/articles/CBMi9876543210zyxwvutsrqponmlkjihgfedcba',
        'http://news.google.com/rss/articles/CBMi_test_token',
      ];

      for (const url of redirectUrls) {
        expect(SearchFallbackFormatter.isGoogleNewsRedirectUrl(url)).toBe(true);
      }

      const canonicalUrls = [
        'https://docs.flutter.dev/release/whats-new',
        'https://pub.dev/packages/flutter_bloc',
        'https://www.reuters.com/technology/apple-event',
        'https://youm7.com/story/2026/09/tech-news',
      ];

      for (const url of canonicalUrls) {
        expect(SearchFallbackFormatter.isGoogleNewsRedirectUrl(url)).toBe(false);
      }
    });

    it('3.2: SearchFallbackFormatter suppresses Google News redirect links and shows clean publisher', () => {
      const searchResults = [
        {
          title: 'Apple Announces Major Intelligence Updates - Reuters',
          snippet: 'Apple unveiled its latest AI developer frameworks at the annual keynote.',
          url: 'https://news.google.com/rss/articles/CBMi1234567890abcdefghijklmnopqrstuvwxyz?oc=5',
          sourceDomain: 'news.google.com',
          sourceName: 'Reuters',
        },
        {
          title: 'Flutter 3.24 Architecture Deep Dive',
          snippet: 'Comprehensive analysis of the new Impeller rendering backend on Android.',
          url: 'https://docs.flutter.dev/release/whats-new?utm_source=twitter',
          sourceDomain: 'docs.flutter.dev',
        },
      ];

      const formattedAr = SearchFallbackFormatter.format(searchResults, {
        targetLanguage: 'ar',
      } as any);

      // Must NEVER leak the ugly Google News token
      expect(formattedAr).not.toContain('news.google.com/rss/articles');
      expect(formattedAr).not.toContain('CBMi');
      expect(formattedAr).not.toContain('🔗 https://news.google.com');

      // Must display clean extracted publisher name
      expect(formattedAr).toContain('🌐 Reuters');

      // Canonical URLs must still display cleanly
      expect(formattedAr).toContain('🌐 docs.flutter.dev');
      expect(formattedAr).toContain('🔗 https://docs.flutter.dev/release/whats-new');
      expect(formattedAr).not.toContain('utm_source=twitter');
    });

    it('3.3: ToolResultFormatter synthesis prompt warns LLM against Google News redirects', () => {
      const synthesisPromptAr = ToolResultFormatter.buildSynthesisPrompt(
        'web_search',
        'sample data',
        { targetLanguage: 'ar', dialect: 'egyptian' } as any
      );

      expect(synthesisPromptAr).toContain('news.google.com/rss/articles');
      expect(synthesisPromptAr).toContain('ولا تضع أبداً روابط Google News');

      const synthesisPromptEn = ToolResultFormatter.buildSynthesisPrompt(
        'web_search',
        'sample data',
        { targetLanguage: 'en' } as any
      );
      expect(synthesisPromptEn).toContain('news.google.com/rss/articles');
      expect(synthesisPromptEn).toContain('NEVER output raw Google News redirect links');
    });

    it('3.4: GroqProvider provides localized Egyptian interim acknowledgment', async () => {
      const groq = new GroqProvider();
      const interim = await groq.generateInterimAcknowledgement(
        'عايز اعرف اسعار الايفون دلوقتي في مصر',
        { targetLanguage: 'ar', dialect: 'egyptian' } as any
      );

      expect(interim).toBe('هشوفلك الأسعار في السوق وأرجعلك على طول.');
    });
  });
});
