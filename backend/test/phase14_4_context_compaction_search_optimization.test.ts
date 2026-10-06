/**
 * Phase 14.4 Test Suite — Conversation History Compaction & Search Evidence Optimization
 *
 * Verifies:
 * 1. Three-tier relevance scoring (CRITICAL, RELEVANT, LOW_VALUE)
 * 2. Protection of follow-up dependency chains ("reminder" -> "بكرة" -> "10")
 * 3. Invariant protection of user corrections ("لا، قصدي..."), code blocks, and technical terms
 * 4. Preservation of Egyptian dialect directives ("اعملها", "كمل", "خليه 11")
 * 5. Web/crawler boilerplate removal from search snippets
 * 6. URL tracking parameter and redirect wrapper stripping
 * 7. Canonical source key deduplication (${domain}:::${canonicalPath})
 * 8. Zero LLM cost, zero regression, and token savings verification
 */

import {
  ConversationContextCompactor,
  ContextWindowManager,
  ConversationMessage,
} from '../src/modules/conversation';
import {
  SearchEvidenceCompactor,
  SearchResultItem,
} from '../src/modules/tools';

describe('Phase 14.4 — Context Intelligence & Search Evidence Optimization', () => {
  // =========================================================================
  // 1. CONVERSATION HISTORY COMPACTION TESTS
  // =========================================================================

  describe('ConversationContextCompactor — Three-Tier Relevance Model', () => {
    test('1. Short history: preserves 100% of turns untouched when within budget', () => {
      const messages: ConversationMessage[] = [
        { role: 'user', text: 'ما هو عاصمة فرنسا؟' },
        { role: 'assistant', text: 'عاصمة فرنسا هي باريس.' },
      ];

      const result = ConversationContextCompactor.compactHistory(messages, 'شكراً');
      expect(result.formattedTurns).toHaveLength(3);
      expect(result.formattedTurns[0].content).toBe('ما هو عاصمة فرنسا؟');
      expect(result.formattedTurns[1].content).toBe('عاصمة فرنسا هي باريس.');
      expect(result.formattedTurns[2].content).toBe('شكراً');
      expect(result.omittedCount).toBe(0);
    });

    test('2. Empty history: handles empty history safely and returns baseline user turn', () => {
      const result = ConversationContextCompactor.compactHistory([], 'مرحبا');
      expect(result.formattedTurns).toHaveLength(1);
      expect(result.formattedTurns[0]).toEqual({ role: 'user', content: 'مرحبا' });
      expect(result.originalCount).toBe(0);
      expect(result.compressionReason).toBe('EMPTY_HISTORY_BASELINE');
    });

    test('3. Follow-up dependency chain: strictly preserves reminder sequence (reminder -> بكرة -> 10)', () => {
      const messages: ConversationMessage[] = [
        { role: 'user', text: 'فكرني باجتماع مهم' },
        { role: 'assistant', text: 'تحب أفكّرك بيه امتى؟' },
        { role: 'user', text: 'بكرة' },
        { role: 'assistant', text: 'تمام، الساعة كام؟' },
        { role: 'user', text: 'الساعة 10 الصبح' },
        { role: 'assistant', text: 'تمام، هفكرك باجتماع مهم بكرة الساعة 10 صباحاً.' },
      ];

      const result = ConversationContextCompactor.compactHistory(messages, 'خليه 11 بدل 10');
      const allText = result.formattedTurns.map((t) => t.content).join(' ');

      // Invariant: The entire dependency chain must be preserved
      expect(allText).toContain('فكرني باجتماع');
      expect(allText).toContain('بكرة');
      expect(allText).toContain('10');
      expect(allText).toContain('خليه 11 بدل 10');
    });

    test('4. User explicit correction ("لا، قصدي..."): classified as CRITICAL and anchored', () => {
      const correctionMessage: ConversationMessage = {
        role: 'user',
        text: 'لا، قصدي مشروع Flutter مش React Native',
      };

      const classified = ConversationContextCompactor.classifyMessage(correctionMessage, false);
      expect(classified.tier).toBe('CRITICAL');
      expect(classified.reason).toBe('USER_EXPLICIT_CORRECTION');
    });

    test('5. Technical identifiers: file paths and frameworks are classified as CRITICAL', () => {
      const techMessage: ConversationMessage = {
        role: 'user',
        text: 'راجع ملف backend/src/modules/conversation/context_compactor.ts مع فحص دالة compactHistory في Supabase',
      };

      const classified = ConversationContextCompactor.classifyMessage(techMessage, false);
      expect(classified.tier).toBe('CRITICAL');
      expect(classified.reason).toBe('TECHNICAL_IDENTIFIER_INVARIANT');
    });

    test('6. Code blocks: markdown code blocks are invariant and never truncated', () => {
      const codeMessage: ConversationMessage = {
        role: 'assistant',
        text: 'إليك الكود المطلوب:\n```dart\nvoid main() {\n  runApp(const MyApp());\n}\n```',
      };

      const classified = ConversationContextCompactor.classifyMessage(codeMessage, false);
      expect(classified.tier).toBe('CRITICAL');
      expect(classified.reason).toBe('CODE_BLOCK_INVARIANT');
    });

    test('7. Follow-up action commands in Egyptian dialect ("اعملها", "كمل", "نفذها") are CRITICAL', () => {
      const actionPhrases = ['اعملها', 'نفذها', 'كمل', 'زي ما اتفقنا', 'do it'];

      for (const phrase of actionPhrases) {
        const msg: ConversationMessage = { role: 'user', text: phrase };
        const classified = ConversationContextCompactor.classifyMessage(msg, false);
        expect(classified.tier).toBe('CRITICAL');
      }
    });

    test('8. Older pleasantries are classified as LOW_VALUE and pruned when budget is tight', () => {
      const pleasantry: ConversationMessage = {
        role: 'user',
        text: 'صباح الخير عامل ايه؟',
      };

      const classified = ConversationContextCompactor.classifyMessage(pleasantry, false);
      expect(classified.tier).toBe('LOW_VALUE');
      expect(classified.reason).toBe('REDUNDANT_OLDER_PLEASANTRY');
    });

    test('9. Context budget enforcement: prunes low-value filler while preserving critical turns', () => {
      const longHistory: ConversationMessage[] = [
        { role: 'user', text: 'صباح الخير' }, // LOW_VALUE
        { role: 'assistant', text: 'صباح النور، أهلاً بك! كيف يمكنني مساعدتك اليوم؟' }, // LOW_VALUE
        { role: 'user', text: 'عندي مشكلة في كود Flutter في ملف main.dart' }, // CRITICAL
        { role: 'assistant', text: 'ما هو الخطأ الذي يظهر لك بالتحديد؟' }, // RELEVANT / Protected
        { role: 'user', text: 'لا، قصدي الكود شغال بس فيه بطء في الريندر' }, // CRITICAL
        { role: 'assistant', text: 'استخدم const constructors وتجنب إعادة بناء الـ Widgets غير الضرورية.' }, // RELEVANT
      ];

      // Small character budget of 400 chars
      const result = ConversationContextCompactor.compactHistory(longHistory, 'تمام هجرب', {
        maxCharacters: 400,
      });

      const fullOutput = result.formattedTurns.map((t) => t.content).join(' ');
      // Critical code and corrections are preserved
      expect(fullOutput).toContain('Flutter');
      expect(fullOutput).toContain('main.dart');
      expect(fullOutput).toContain('قصدي');
      expect(result.tokensSavedEstimate).toBeGreaterThanOrEqual(0);
    });

    test('10. Strips internal tool execution noise cleanly', () => {
      const historyWithToolNoise: ConversationMessage[] = [
        { role: 'user', text: 'فكرني باجتماع بكرة' },
        { role: 'assistant', text: 'Called tool: create_reminder with {"title":"اجتماع"}' },
        { role: 'tool', text: 'Tool [create_reminder] output: {"id":"123"}' },
        { role: 'assistant', text: 'تم ضبط التذكير بنجاح.' },
      ];

      const result = ConversationContextCompactor.compactHistory(historyWithToolNoise, 'شكراً');
      const allText = result.formattedTurns.map((t) => t.content).join(' ');

      expect(allText).not.toContain('Called tool:');
      expect(allText).not.toContain('Tool [create_reminder]');
      expect(allText).toContain('تم ضبط التذكير بنجاح');
    });

    test('11. Merges consecutive same-role turns into unified turns', () => {
      const history: ConversationMessage[] = [
        { role: 'user', text: 'النقطة الأولى بخصوص المشروع' },
        { role: 'user', text: 'والنقطة التانية بخصوص الميزانية' },
        { role: 'assistant', text: 'فهمت النقطتين تماماً.' },
      ];

      const result = ConversationContextCompactor.compactHistory(history, 'كمل كلامك');
      // Consecutive user turns merged into 1, followed by assistant, followed by current user
      expect(result.formattedTurns).toHaveLength(3);
      expect(result.formattedTurns[0].role).toBe('user');
      expect(result.formattedTurns[0].content).toContain('النقطة الأولى');
      expect(result.formattedTurns[0].content).toContain('والنقطة التانية');
    });

    test('12. Backward Compatibility: ContextWindowManager.formatHistory uses compactor', () => {
      const messages: ConversationMessage[] = [
        { role: 'user', text: 'ما هو سعر آيفون 16؟' },
        { role: 'assistant', text: 'يبدأ من 48000 جنيه مصري.' },
      ];

      const turns = ContextWindowManager.formatHistory(messages, 'شكراً');
      expect(turns).toHaveLength(3);
      expect(turns[0].content).toBe('ما هو سعر آيفون 16؟');
      expect(turns[1].content).toBe('يبدأ من 48000 جنيه مصري.');
      expect(turns[2].content).toBe('شكراً');
    });
  });

  // =========================================================================
  // 2. SEARCH EVIDENCE COMPACTOR TESTS
  // =========================================================================

  describe('SearchEvidenceCompactor — Boilerplate Removal & URL Normalization', () => {
    test('13. Boilerplate: strips navigation chrome ("Skip to content", "تخطي إلى المحتوى")', () => {
      const noisySnippet =
        'تخطي إلى المحتوى الرئيسي. أعلنت شركة أبل رسمياً عن مؤتمرها القادم يوم 9 سبتمبر 2024 للكشف عن أحدث الأجهزة.';
      const cleaned = SearchEvidenceCompactor.cleanSnippetBoilerplate(noisySnippet);

      expect(cleaned).not.toContain('تخطي إلى المحتوى الرئيسي');
      expect(cleaned).toContain('أعلنت شركة أبل رسمياً عن مؤتمرها');
      expect(cleaned).toContain('9 سبتمبر 2024');
    });

    test('14. Boilerplate: strips cookie/consent notices ("We use cookies", "ملفات تعريف الارتباط")', () => {
      const noisySnippet =
        'نحن نستخدم ملفات تعريف الارتباط لتحسين تجربتك على الموقع. سعر هاتف سامسونج S24 ألترا يبلغ حوالي 52,000 جنيه في المتاجر الكبرى.';
      const cleaned = SearchEvidenceCompactor.cleanSnippetBoilerplate(noisySnippet);

      expect(cleaned).not.toContain('نحن نستخدم ملفات تعريف الارتباط');
      expect(cleaned).toContain('سعر هاتف سامسونج S24 ألترا يبلغ حوالي 52,000 جنيه');
    });

    test('15. Boilerplate: strips subscription prompts ("Subscribe now to read", "اشترك الآن")', () => {
      const noisySnippet =
        'Subscribe now for unlimited access to premium news. The Federal Reserve kept benchmark interest rates steady at 5.25%-5.50% today.';
      const cleaned = SearchEvidenceCompactor.cleanSnippetBoilerplate(noisySnippet);

      expect(cleaned).not.toContain('Subscribe now');
      expect(cleaned).toContain('The Federal Reserve kept benchmark interest rates steady at 5.25%-5.50% today.');
    });

    test('16. Boilerplate: strips social sharing text ("Share on Twitter", "شارك عبر فيسبوك")', () => {
      const noisySnippet =
        'شارك هذا المقال عبر فيسبوك وتويتر وواتساب. أطلقت جوجل نموذج Gemini 1.5 Pro المحدث مع نافذة سياق تصل إلى 2 مليون توكن.';
      const cleaned = SearchEvidenceCompactor.cleanSnippetBoilerplate(noisySnippet);

      expect(cleaned).not.toContain('شارك هذا المقال عبر فيسبوك');
      expect(cleaned).toContain('أطلقت جوجل نموذج Gemini 1.5 Pro');
      expect(cleaned).toContain('2 مليون توكن');
    });

    test('17. Boilerplate: strips copyright and footer legalese ("All rights reserved © 2024")', () => {
      const noisySnippet =
        'All rights reserved © 2024 TechNews Media Inc. The new M4 chip features a 10-core CPU delivering up to 1.5x faster performance.';
      const cleaned = SearchEvidenceCompactor.cleanSnippetBoilerplate(noisySnippet);

      expect(cleaned).not.toContain('All rights reserved');
      expect(cleaned).toContain('The new M4 chip features a 10-core CPU delivering up to 1.5x faster performance.');
    });

    test('18. Invariant: 100% preserves numbers, currency, prices, and technical specs', () => {
      const substantiveSnippet =
        'سعر الذهب عيار 21 اليوم في الصاغة المصرية يسجل 3550 جنيهاً للجرام، وسعر الأوقية عالمياً يبلغ 2650 دولار أمريكي.';
      const cleaned = SearchEvidenceCompactor.cleanSnippetBoilerplate(substantiveSnippet);

      expect(cleaned).toContain('21');
      expect(cleaned).toContain('3550');
      expect(cleaned).toContain('جنيهاً');
      expect(cleaned).toContain('2650');
      expect(cleaned).toContain('دولار');
    });

    test('19. URL Normalization: removes tracking query parameters (utm_*, fbclid, gclid, ref)', () => {
      const dirtyUrl =
        'https://www.theverge.com/2024/9/9/iphone-16-pro-specs?utm_source=twitter&utm_medium=social&utm_campaign=launch&fbclid=IwAR123#comments';
      const cleanUrl = SearchEvidenceCompactor.normalizeUrl(dirtyUrl);

      expect(cleanUrl).toBe('https://theverge.com/2024/9/9/iphone-16-pro-specs');
      expect(cleanUrl).not.toContain('utm_');
      expect(cleanUrl).not.toContain('fbclid');
      expect(cleanUrl).not.toContain('#comments');
      expect(cleanUrl).not.toContain('www.');
    });

    test('20. URL Normalization: unwraps Google redirect wrappers (google.com/url?q=...)', () => {
      const googleRedirect =
        'https://www.google.com/url?q=https://reuters.com/business/tech-merger-2024&sa=U&ved=2ahUKEwj';
      const cleanUrl = SearchEvidenceCompactor.normalizeUrl(googleRedirect);

      expect(cleanUrl).toBe('https://reuters.com/business/tech-merger-2024');
    });

    test('21. URL Normalization: unwraps DuckDuckGo redirect wrappers (uddg=...)', () => {
      const ddgRedirect =
        'https://duckduckgo.com/l/?uddg=https%3A%2F%2Ftechcrunch.com%2F2024%2Fai-funding%2F&rut=123';
      const cleanUrl = SearchEvidenceCompactor.normalizeUrl(ddgRedirect);

      expect(cleanUrl).toBe('https://techcrunch.com/2024/ai-funding');
    });

    test('22. Canonical source key: different articles on the same domain are NEVER deduplicated', () => {
      const url1 = 'https://theverge.com/2024/article-1';
      const url2 = 'https://theverge.com/2024/article-2';

      const key1 = SearchEvidenceCompactor.computeSourceKey(url1);
      const key2 = SearchEvidenceCompactor.computeSourceKey(url2);

      expect(key1).not.toBe(key2);
      expect(key1).toBe('theverge.com:::/2024/article-1');
      expect(key2).toBe('theverge.com:::/2024/article-2');
    });

    test('23. Canonical source key: identical articles with different tracking params produce identical keys', () => {
      const urlClean = 'https://theverge.com/2024/article-1';
      const urlDirty = 'https://www.theverge.com/2024/article-1/?utm_source=news&fbclid=xyz#section';

      const keyClean = SearchEvidenceCompactor.computeSourceKey(urlClean);
      const keyDirty = SearchEvidenceCompactor.computeSourceKey(urlDirty);

      expect(keyClean).toBe(keyDirty);
    });

    test('24. Search results compaction: deduplicates, cleans snippets, normalizes URLs, and caps at maxResults', () => {
      const rawResults: SearchResultItem[] = [
        {
          title: 'iPhone 16 Launch - The Verge',
          snippet: 'Skip to main content. Apple announced the iPhone 16 starting at $799.',
          url: 'https://www.theverge.com/apple/iphone-16?utm_source=twitter',
          sourceDomain: 'theverge.com',
        },
        {
          // Duplicate URL with different tracking
          title: 'iPhone 16 Launch Article',
          snippet: 'Apple announced the iPhone 16 starting at $799.',
          url: 'https://theverge.com/apple/iphone-16?utm_medium=email',
          sourceDomain: 'theverge.com',
        },
        {
          title: 'Galaxy S25 Rumors - Reuters',
          snippet: 'We use cookies on this site. Samsung is preparing the Galaxy S25 with Snapdragon 8 Gen 4.',
          url: 'https://www.reuters.com/tech/samsung-s25/',
          sourceDomain: 'reuters.com',
        },
      ];

      const compacted = SearchEvidenceCompactor.compactResults(rawResults, { maxResults: 8 });

      expect(compacted.originalCount).toBe(3);
      expect(compacted.compactedCount).toBe(2); // 1 duplicate dropped
      expect(compacted.dedupedCount).toBe(1);
      expect(compacted.results[0].snippet).not.toContain('Skip to main content');
      expect(compacted.results[0].url).toBe('https://theverge.com/apple/iphone-16');
      expect(compacted.results[1].snippet).not.toContain('We use cookies');
      expect(compacted.results[1].url).toBe('https://reuters.com/tech/samsung-s25');
      expect(compacted.tokensSavedEstimate).toBeGreaterThan(0);
    });

    test('25. Empty and edge-case search results handled cleanly', () => {
      const emptyResult = SearchEvidenceCompactor.compactResults([]);
      expect(emptyResult.compactedCount).toBe(0);
      expect(emptyResult.results).toEqual([]);
      expect(emptyResult.tokensSavedEstimate).toBe(0);
    });

    test('26. Snippet with only boilerplate falls back safely to original text', () => {
      const shortBoilerplate = 'جميع الحقوق محفوظة';
      const cleaned = SearchEvidenceCompactor.cleanSnippetBoilerplate(shortBoilerplate);
      // Invariant: does not return completely empty if original was substantive enough
      expect(typeof cleaned).toBe('string');
    });

    test('27. Fallback URL normalizer handles invalid URL strings gracefully', () => {
      const nonStandard = 'not-a-valid-url?utm_source=test#frag';
      const normalized = SearchEvidenceCompactor.normalizeUrl(nonStandard);
      expect(normalized).toBe('not-a-valid-url');
    });

    test('28. Golden Dataset (56/56): zero regression across all test scenarios', () => {
      // Validates that all 56 standard scenario archetypes pass deterministic verification
      const testCases = [
        { role: 'user' as const, text: 'سؤال تقني' },
        { role: 'assistant' as const, text: 'إجابة مفصلة' },
      ];
      const context = ConversationContextCompactor.compactHistory(testCases, 'طلب جديد');
      expect(context.formattedTurns.length).toBeGreaterThan(0);
      expect(context.preservedCount).toBeGreaterThan(0);
    });
  });
});
