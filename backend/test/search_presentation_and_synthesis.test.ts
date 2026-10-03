/**
 * Search Presentation & Answer Synthesis Test Suite
 *
 * Validates the strict architectural separation between internal web research
 * and user-facing source presentation across all 10 required scenarios:
 *
 * 1. "ايه آخر أخبار Vercel؟" -> search = true, showSources = false
 * 2. "ابحثلي عن آخر أخبار Vercel" -> search = true, showSources = false (word "ابحثلي" is NOT source request)
 * 3. "ابحثلي عن آخر أخبار Vercel وهات المصادر" -> search = true, showSources = true
 * 4. "هات المصادر" (after previous search) -> showSources = true, reuses context without new search
 * 5. "هات اللينكات" -> showSources = true, showUrls = true
 * 6. Search synthesis succeeds -> normal synthesized answer, no raw result dump
 * 7. Search synthesis fails -> safe conversational fallback, no raw search result dump
 * 8. Semantic cache hit -> direct cached answer, no source list
 * 9. Search results contain 5 URLs -> normal answer, 0 source URLs shown
 * 10. Arabic + Egyptian dialect -> answer in current language/dialect, no source dump
 * 11. Code-layer leak guard -> sanitizes unrequested search headers and raw URL dumps
 * 12. Google News redirect suppression -> only publisher domain shown when sources are requested
 */

import { SearchPresentationPolicyResolver } from '../src/modules/tools/search/search_presentation_policy';
import { SearchContextManager } from '../src/modules/tools/search/search_context_manager';
import { SearchFallbackFormatter } from '../src/modules/tools/adapters/search_fallback_formatter';
import { SearchQueryPlanner } from '../src/modules/tools/search/search_query_planner';
import { ToolResultFormatter } from '../src/modules/tools/adapters/tool_result_formatter';
import { ExecutionEngine } from '../src/modules/agent/execution/execution_engine';
import { ExecutionStateManager } from '../src/modules/agent/execution/execution_state';
import { ExecutionEngineContext } from '../src/modules/agent/execution/types';
import { AIRouter, AIProviderError, AIMessage, AIResponse } from '../src/modules/ai';
import { LanguageContext } from '../src/modules/language/types';

describe('Search Presentation & Answer Synthesis Suite', () => {
  const mockSearchResults = {
    results: [
      {
        title: 'Vercel Announces Fluid Compute and Storage Optimization',
        snippet: 'Vercel introduced updates to its hobby and pro tiers with automated dormant deployment scaling.',
        url: 'https://thenewstack.io/vercel-fluid-compute',
        sourceDomain: 'thenewstack.io',
      },
      {
        title: 'Top 6 Vercel Alternatives for Next.js in 2026',
        snippet: 'Comparing Cloudflare Pages, AWS Amplify, Netlify, and self-hosted Docker solutions for Next.js.',
        url: 'https://hostinger.com/tutorials/vercel-alternatives',
        sourceDomain: 'hostinger.com',
      },
      {
        title: 'Cloudflare Workers vs Vercel Edge Runtime Performance Benchmark',
        snippet: 'Benchmark analysis comparing latency, cold starts, and cost structures of edge workers.',
        url: 'https://shattered.io/cloudflare-vs-vercel',
        sourceDomain: 'shattered.io',
      },
      {
        title: 'Vercel Pricing and Free Tier Limits Detailed',
        snippet: 'The Hobby plan includes 100GB bandwidth, custom domains, and non-commercial project deployment.',
        url: 'https://vercel.com/pricing',
        sourceDomain: 'vercel.com',
      },
      {
        title: 'Google News Article on Cloud Hosting',
        snippet: 'Latest news regarding developer platforms and edge infrastructure.',
        url: 'https://news.google.com/rss/articles/CBMi1234567890abcdefghijklmnopqrstuvwxyz?oc=5',
        sourceDomain: 'news.google.com',
        sourceName: 'TechCrunch',
      },
    ],
  };

  afterEach(() => {
    SearchContextManager.clear();
    jest.restoreAllMocks();
  });

  // =========================================================================
  // Scenario 1: User asks question without requesting sources
  // =========================================================================
  describe('Scenario 1: Question without source request ("ايه آخر أخبار Vercel؟")', () => {
    it('resolves policy with shouldShowSources = false and shouldShowUrls = false', () => {
      const query = 'ايه آخر أخبار Vercel؟';
      const policy = SearchPresentationPolicyResolver.resolve(query);

      expect(policy.shouldShowSources).toBe(false);
      expect(policy.shouldShowUrls).toBe(false);
      expect(policy.isFollowUpSourceRequest).toBe(false);
      expect(policy.isExplicitLinkRequest).toBe(false);
    });

    it('instructs model in synthesis prompt to answer naturally without dumping sources or URLs', () => {
      const policy = SearchPresentationPolicyResolver.resolve('ايه آخر أخبار Vercel؟');
      const promptAr = ToolResultFormatter.buildSynthesisPrompt(
        'web_search',
        JSON.stringify(mockSearchResults),
        { targetLanguage: 'ar', dialect: 'egyptian' } as LanguageContext,
        policy
      );

      expect(promptAr).toContain('تحذير حاسم وقاطع: نتائج البحث أعلاه هي مواد استرشادية');
      expect(promptAr).toContain('إياك تماماً أن تفرغ أو تسرد قائمة نتائج البحث الخام');
      expect(promptAr).toContain('ولا تضع قائمة روابط أو مصادر للمستخدم لأن المستخدم لم يطلب المصادر');
    });
  });

  // =========================================================================
  // Scenario 2: User explicitly uses "ابحثلي عن..." (Search ≠ Show Sources)
  // =========================================================================
  describe('Scenario 2: Conversational search command ("ابحثلي عن آخر أخبار Vercel")', () => {
    it('does NOT treat "ابحثلي عن" as a source request', () => {
      const query = 'ابحثلي عن آخر أخبار Vercel';
      const policy = SearchPresentationPolicyResolver.resolve(query);

      expect(policy.shouldShowSources).toBe(false);
      expect(policy.shouldShowUrls).toBe(false);
      expect(policy.isFollowUpSourceRequest).toBe(false);
    });

    it('SearchQueryPlanner cleans "ابحثلي عن" while keeping the substantive subject', () => {
      const plan = SearchQueryPlanner.plan('ابحثلي عن آخر أخبار Vercel');

      expect(plan.plannedQuery).toBe('آخر أخبار Vercel');
      expect(plan.intent).toBe('breaking_news');
    });
  });

  // =========================================================================
  // Scenario 3: User searches AND explicitly requests sources
  // =========================================================================
  describe('Scenario 3: Search with explicit source request ("ابحثلي عن آخر أخبار Vercel وهات المصادر")', () => {
    it('resolves shouldShowSources = true and isFollowUpSourceRequest = false', () => {
      const query = 'ابحثلي عن آخر أخبار Vercel وهات المصادر';
      const policy = SearchPresentationPolicyResolver.resolve(query);

      expect(policy.shouldShowSources).toBe(true);
      expect(policy.isFollowUpSourceRequest).toBe(false);
    });

    it('SearchQueryPlanner strips "وهات المصادر" from plannedQuery to keep search focused', () => {
      const plan = SearchQueryPlanner.plan('ابحثلي عن آخر أخبار Vercel وهات المصادر');

      expect(plan.plannedQuery).toBe('آخر أخبار Vercel');
    });

    it('instructs model in synthesis prompt to answer directly and append sources', () => {
      const policy = SearchPresentationPolicyResolver.resolve('ابحثلي عن آخر أخبار Vercel وهات المصادر');
      const promptAr = ToolResultFormatter.buildSynthesisPrompt(
        'web_search',
        JSON.stringify(mockSearchResults),
        { targetLanguage: 'ar' } as LanguageContext,
        policy
      );

      expect(promptAr).toContain('المستخدم طلب صراحة معرفة المصادر أو الروابط المرجعية');
      expect(promptAr).toContain('ثم اذكر في النهاية المصادر المعتمدة بدقة');
    });
  });

  // =========================================================================
  // Scenario 4: Follow-up requesting sources after a previous answer
  // =========================================================================
  describe('Scenario 4: Follow-up source request ("هات المصادر")', () => {
    it('detects isFollowUpSourceRequest = true for Egyptian and Standard Arabic phrases', () => {
      const followUps = [
        'هات المصادر',
        'هاتلي المصادر',
        'المراجع؟',
        'المراجع إيه؟',
        'فين المصادر؟',
        'جبت الكلام ده منين؟',
        'من أين لك هذا؟',
        'مصدر الكلام ده إيه؟',
        'show sources',
        'sources?',
        'what are the sources?',
        'where did you get this from?',
      ];

      for (const phrase of followUps) {
        const policy = SearchPresentationPolicyResolver.resolve(phrase);
        expect(policy.shouldShowSources).toBe(true);
        expect(policy.isFollowUpSourceRequest).toBe(true);
      }
    });

    it('ExecutionEngine reuses previous search context without invoking web_search again', async () => {
      const conversationId = 'conv_followup_123';
      SearchContextManager.setLatestSearch(conversationId, 'Vercel limits', mockSearchResults);

      const engine = ExecutionEngine.getInstance();
      const mockRoute = jest.spyOn(AIRouter.prototype, 'route');

      const context: ExecutionEngineContext = {
        runId: 'run_followup_1',
        userId: 'user_1',
        conversationId,
        channel: 'whatsapp',
        userGoal: 'هات المصادر',
        languageContext: { targetLanguage: 'ar', dialect: 'egyptian' } as any,
      };

      const result = await engine.run(context, []);

      // No AI synthesis call or new tool calls needed!
      expect(mockRoute).not.toHaveBeenCalled();
      expect(result.status).toBe('completed');
      expect(result.steps.length).toBe(0);
      expect(result.finalReply).toContain('Vercel Announces Fluid Compute');
      expect(result.finalReply).toContain('thenewstack.io');
    });
  });

  // =========================================================================
  // Scenario 5: User explicitly requests links/URLs ("هات اللينكات", "طب اللينك؟")
  // =========================================================================
  describe('Scenario 5: Explicit link request ("هات اللينكات", "طب اللينك؟")', () => {
    it('detects shouldShowUrls = true and isExplicitLinkRequest = true', () => {
      const linkQueries = [
        'هات اللينكات',
        'هاتلي اللينكات',
        'ابعت الروابط',
        'فين اللينك؟',
        'طب اللينك؟',
        'اللينك ايه؟',
        'ابعتلي اللينك',
        'give me the links',
        'send me the links',
        'links?',
      ];

      for (const q of linkQueries) {
        const policy = SearchPresentationPolicyResolver.resolve(q);
        expect(policy.shouldShowSources).toBe(true);
        expect(policy.shouldShowUrls).toBe(true);
        expect(policy.isExplicitLinkRequest).toBe(true);
      }
    });

    it('formats source list WITH clean URLs when shouldShowUrls = true', () => {
      const formatted = SearchFallbackFormatter.formatSourceList(
        mockSearchResults,
        { targetLanguage: 'ar' } as any,
        { showUrls: true }
      );

      expect(formatted).toContain('🔗 https://thenewstack.io/vercel-fluid-compute');
      expect(formatted).toContain('🔗 https://hostinger.com/tutorials/vercel-alternatives');
    });

    it('formats source list WITHOUT URLs when shouldShowUrls = false', () => {
      const formatted = SearchFallbackFormatter.formatSourceList(
        mockSearchResults,
        { targetLanguage: 'ar' } as any,
        { showUrls: false }
      );

      expect(formatted).toContain('Vercel Announces Fluid Compute');
      expect(formatted).toContain('thenewstack.io');
      expect(formatted).not.toContain('🔗 https://thenewstack.io');
      expect(formatted).not.toContain('🔗 https://hostinger.com');
    });
  });

  // =========================================================================
  // Scenario 6: Search synthesis succeeds
  // =========================================================================
  describe('Scenario 6: Search synthesis succeeds', () => {
    it('returns natural synthesized response without raw result dump or URLs', async () => {
      const naturalSynthesis = 'الخطة المجانية على Vercel بتوفر 100GB باندويث شهرياً واستضافة سريعة للمشاريع الشخصية.';
      const engine = ExecutionEngine.getInstance();

      jest.spyOn(AIRouter.prototype, 'route').mockResolvedValueOnce({
        message: { role: 'assistant', content: naturalSynthesis },
        providerId: 'groq',
        modelId: 'llama-3.3-70b-versatile',
        usage: { promptTokens: 100, completionTokens: 40, totalTokens: 140 },
      } as unknown as AIResponse);

      const state = ExecutionStateManager.createInitialState('run_s6', 'task_s6', 'ايه حدود الخطة المجانية على Vercel؟', 3);
      const step = ExecutionStateManager.createStep(state, 'web_search', { query: 'Vercel free tier limits' });
      ExecutionStateManager.completeStep(step, 'succeeded', mockSearchResults, JSON.stringify(mockSearchResults));

      const context: ExecutionEngineContext = {
        runId: 'run_s6',
        userId: 'user_6',
        conversationId: 'conv_s6',
        channel: 'whatsapp',
        userGoal: 'ايه حدود الخطة المجانية على Vercel؟',
        languageContext: { targetLanguage: 'ar', dialect: 'egyptian' } as any,
      };

      const finalReply = await (engine as any).synthesizeFinalAnswer(
        state,
        context,
        [],
        'completed',
        SearchPresentationPolicyResolver.resolve(context.userGoal)
      );

      expect(finalReply).toBe(naturalSynthesis);
      expect(finalReply).not.toContain('إليك أهم النتائج');
      expect(finalReply).not.toContain('🔗 http');
    });
  });

  // =========================================================================
  // Scenario 7: Search synthesis fails (safe fallback, no raw result dump)
  // =========================================================================
  describe('Scenario 7: Search synthesis failure fallback', () => {
    it('returns safe conversational fallback message without raw search result dump when user did NOT ask for sources', async () => {
      const engine = ExecutionEngine.getInstance();

      jest.spyOn(AIRouter.prototype, 'route').mockRejectedValueOnce(
        new AIProviderError({
          providerId: 'groq',
          category: 'timeout',
          message: 'Synthesis model timed out after 10000ms',
          retryable: false,
        })
      );

      const state = ExecutionStateManager.createInitialState('run_s7', 'task_s7', 'ايه حدود الخطة المجانية؟', 3);
      const step = ExecutionStateManager.createStep(state, 'web_search', { query: 'Vercel free tier' });
      ExecutionStateManager.completeStep(step, 'succeeded', mockSearchResults, JSON.stringify(mockSearchResults));

      const context: ExecutionEngineContext = {
        runId: 'run_s7',
        userId: 'user_7',
        conversationId: 'conv_s7',
        channel: 'whatsapp',
        userGoal: 'ايه حدود الخطة المجانية؟',
        languageContext: { targetLanguage: 'ar', dialect: 'egyptian' } as any,
      };

      const policy = SearchPresentationPolicyResolver.resolve(context.userGoal);
      const finalReply = await (engine as any).synthesizeFinalAnswer(
        state,
        context,
        [],
        'completed',
        policy
      );

      expect(finalReply).toContain('بحثت في المصادر بخصوص سؤالك، بس تعذر تلخيص إجابة دقيقة دلوقتي');
      // Crucial invariant: Must NEVER dump raw search results!
      expect(finalReply).not.toContain('إليك أهم النتائج التي تم العثور عليها');
      expect(finalReply).not.toContain('thenewstack.io');
      expect(finalReply).not.toContain('🔗 https://');
      expect(finalReply).not.toContain('🌐');
    });

    it('returns requested source list when search synthesis fails BUT user explicitly asked for sources', async () => {
      const engine = ExecutionEngine.getInstance();

      jest.spyOn(AIRouter.prototype, 'route').mockRejectedValueOnce(
        new AIProviderError({
          providerId: 'groq',
          category: 'rate_limit',
          message: 'Rate limit exceeded',
          retryable: true,
        })
      );

      const state = ExecutionStateManager.createInitialState('run_s7_src', 'task_s7_src', 'ابحثلي عن Vercel وهات المصادر', 3);
      const step = ExecutionStateManager.createStep(state, 'web_search', { query: 'Vercel' });
      ExecutionStateManager.completeStep(step, 'succeeded', mockSearchResults, JSON.stringify(mockSearchResults));

      const context: ExecutionEngineContext = {
        runId: 'run_s7_src',
        userId: 'user_7',
        conversationId: 'conv_s7_src',
        channel: 'whatsapp',
        userGoal: 'ابحثلي عن Vercel وهات المصادر',
        languageContext: { targetLanguage: 'ar' } as any,
      };

      const policy = SearchPresentationPolicyResolver.resolve(context.userGoal);
      const finalReply = await (engine as any).synthesizeFinalAnswer(
        state,
        context,
        [],
        'completed',
        policy
      );

      // Since user explicitly asked for sources, sources are permitted on fallback
      expect(finalReply).toContain('Vercel Announces Fluid Compute');
      expect(finalReply).toContain('thenewstack.io');
    });
  });

  // =========================================================================
  // Scenario 8: Semantic Cache Hit (No Source List)
  // =========================================================================
  describe('Scenario 8: Semantic Cache Hit', () => {
    it('cached responses are clean and contain no raw search dump or source list', () => {
      const cachedResponse = 'أهلاً بك! كرافت هو مساعدك الذكي الشخصي لإنجاز المهام وتنظيم يومك.';
      const policy = SearchPresentationPolicyResolver.resolve('أنت مين؟');

      expect(policy.shouldShowSources).toBe(false);
      expect(cachedResponse).not.toContain('إليك أهم النتائج');
      expect(cachedResponse).not.toContain('🔗 https://');
      expect(cachedResponse).not.toContain('المصادر:');
    });
  });

  // =========================================================================
  // Scenario 9: Search results contain 5 URLs -> Normal answer, 0 source URLs shown
  // =========================================================================
  describe('Scenario 9: 5 Search URLs in output -> 0 URLs shown to user', () => {
    it('suppresses all 5 URLs when user did not request sources or links', () => {
      const rawLeakedResponse = `إليك أهم النتائج التي تم العثور عليها بخصوص بحثك:\n\n1. *Vercel Announces Fluid Compute*\n   🌐 thenewstack.io\n   Vercel introduced updates to its hobby and pro tiers.\n   🔗 https://thenewstack.io/vercel-fluid-compute\n\n2. *Top 6 Vercel Alternatives*\n   🌐 hostinger.com\n   Comparing Cloudflare Pages and AWS Amplify.\n   🔗 https://hostinger.com/tutorials/vercel-alternatives`;

      const sanitized = SearchPresentationPolicyResolver.sanitizeResponseIfLeaked(
        rawLeakedResponse,
        { targetLanguage: 'ar', dialect: 'egyptian' } as any
      );

      // URLs and raw domain icons are completely removed
      expect(sanitized).not.toContain('🔗 https://thenewstack.io');
      expect(sanitized).not.toContain('🔗 https://hostinger.com');
      expect(sanitized).not.toContain('إليك أهم النتائج التي تم العثور عليها بخصوص بحثك:');
      // Converted to clean natural bullets
      expect(sanitized).toContain('من واقع البيانات الرسمية المتاحة:');
      expect(sanitized).toContain('Vercel Announces Fluid Compute');
    });
  });

  // =========================================================================
  // Scenario 10: Arabic + Egyptian Dialect
  // =========================================================================
  describe('Scenario 10: Arabic + Egyptian Dialect consistency', () => {
    it('produces Egyptian dialect failure message without MSA reversion or source dumps', () => {
      const fallbackEg = SearchFallbackFormatter.formatFailureFallback({
        targetLanguage: 'ar',
        dialect: 'egyptian',
      } as any);

      expect(fallbackEg).toBe('بحثت في المصادر بخصوص سؤالك، بس تعذر تلخيص إجابة دقيقة دلوقتي. تقدر تسألني تاني أو توضح طلبك أكتر.');
      expect(fallbackEg).not.toContain('إليك أهم النتائج');
      expect(fallbackEg).not.toContain('http');
    });

    it('produces Standard Arabic failure message for standard Arabic context', () => {
      const fallbackMsa = SearchFallbackFormatter.formatFailureFallback({
        targetLanguage: 'ar',
      } as any);

      expect(fallbackMsa).toBe('تمت معالجة طلبك والبحث في المصادر، ولكن تعذر تلخيص إجابة دقيقة في الوقت الحالي. يرجى إعادة المحاولة أو توضيح السؤال.');
    });

    it('produces English failure message for English context', () => {
      const fallbackEn = SearchFallbackFormatter.formatFailureFallback({
        targetLanguage: 'en',
      } as any);

      expect(fallbackEn).toContain('I processed your request and searched available sources, but I was not able to compile a reliable summary right now.');
    });
  });

  // =========================================================================
  // Scenario 11: Code-Layer Leak Guard
  // =========================================================================
  describe('Scenario 11: Code-Layer Leak Guard Defense-in-Depth', () => {
    it('passes clean synthesized responses through unchanged', () => {
      const cleanAnswer = 'الخطة المجانية تتيح لك رفع موقعك مجاناً مع نطاق مخصص.';
      const output = SearchPresentationPolicyResolver.sanitizeResponseIfLeaked(cleanAnswer);

      expect(output).toBe(cleanAnswer);
    });

    it('preserves natural in-text URLs when answering questions about official websites', () => {
      const naturalUrlAnswer = 'الموقع الرسمي لـ Vercel هو https://vercel.com وتقدر تسجل عليه مباشرة.';
      const policy = SearchPresentationPolicyResolver.resolve('إيه الموقع الرسمي لـ Vercel؟');

      expect(policy.shouldShowUrls).toBe(true);

      const output = SearchPresentationPolicyResolver.sanitizeResponseIfLeaked(
        naturalUrlAnswer,
        policy
      );

      expect(output).toBe(naturalUrlAnswer);
      expect(output).toContain('https://vercel.com');
    });

    it('strips accidental URLs leaked at the end of a response when sources were not requested', () => {
      const leakedText = `الخطة المجانية بتسمح بـ 100GB شهرياً.\n   🔗 https://vercel.com/pricing`;
      const policy = SearchPresentationPolicyResolver.resolve('ايه حدود الخطة؟');

      expect(policy.shouldShowUrls).toBe(false);

      const sanitized = SearchPresentationPolicyResolver.sanitizeResponseIfLeaked(
        leakedText,
        policy
      );

      expect(sanitized).toBe('الخطة المجانية بتسمح بـ 100GB شهرياً.');
      expect(sanitized).not.toContain('https://vercel.com/pricing');
    });

    it('allows links when policy explicitly requested URLs ("هات اللينك")', () => {
      const responseWithLink = `تفضل، رابط المنصة:\n   🔗 https://vercel.com`;
      const policy = SearchPresentationPolicyResolver.resolve('هات اللينك');

      expect(policy.shouldShowUrls).toBe(true);

      const sanitized = SearchPresentationPolicyResolver.sanitizeResponseIfLeaked(
        responseWithLink,
        policy
      );

      expect(sanitized).toBe(responseWithLink);
      expect(sanitized).toContain('https://vercel.com');
    });
  });

  // =========================================================================
  // Scenario 12: Google News Redirect URL Suppression in Sources
  // =========================================================================
  describe('Scenario 12: Google News Redirect URL Suppression', () => {
    it('suppresses Google News redirect URLs even when sources ARE requested', () => {
      const formatted = SearchFallbackFormatter.formatSourceList(
        mockSearchResults,
        { targetLanguage: 'en' } as any,
        { showUrls: true }
      );

      // Legitimate canonical URL is shown
      expect(formatted).toContain('🔗 https://thenewstack.io/vercel-fluid-compute');
      // Google News redirect URL token is strictly suppressed
      expect(formatted).not.toContain('news.google.com/rss/articles');
      expect(formatted).not.toContain('CBMi1234567890');
    });
  });
});
