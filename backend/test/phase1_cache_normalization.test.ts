import { normalizeMessage, collapseRepeatedChars, normalizeArabicVariants } from '../src/modules/cache/text_normalizer';
import { LocalLanguageDetector } from '../src/modules/cache/language_detector';

describe('Phase 1: Text Normalizer & Language Detector', () => {
  describe('TextNormalizer', () => {
    test('collapses repeated elongated characters', () => {
      expect(collapseRepeatedChars('اهلاااااا')).toBe('اهلا');
      expect(collapseRepeatedChars('سلاااام')).toBe('سلام');
      expect(collapseRepeatedChars('hellloooo')).toBe('hello');
      expect(collapseRepeatedChars('sooooo')).toBe('so');
    });

    test('normalizes Arabic orthographic variants, tashkeel and taa marbouta', () => {
      expect(normalizeArabicVariants('أَهْلاً')).toBe('اهلا');
      expect(normalizeArabicVariants('إِلَى')).toBe('الي');
      expect(normalizeArabicVariants('آخِر')).toBe('اخر');
      expect(normalizeArabicVariants('مدرسة')).toBe('مدرسه');
      expect(normalizeArabicVariants('مسؤلية')).toBe('مسوليه');
    });

    test('normalizeMessage produces normalized form while strictly preserving original message', () => {
      const raw = 'أهلاً وسهلاً بك يا فنان!! 😄👋 هل يمكنك المساعدة؟؟؟';
      const result = normalizeMessage(raw);

      expect(result.original).toBe(raw);
      expect(result.normalized).toBe('اهلا وسهلا بك يا فنان هل يمكنك المساعده');
      expect(result.tokens).toContain('اهلا');
      expect(result.tokens).toContain('وسهلا');
      expect(result.tokens).toContain('المساعده');
    });

    test('normalizes English contractions and casing', () => {
      const raw = "HELLO!! I can't find my order, what's happening???";
      const result = normalizeMessage(raw);

      expect(result.original).toBe(raw);
      expect(result.normalized).toBe('hello i cannot find my order what is happening');
      expect(result.tokens).toContain('cannot');
    });

    test('handles empty and whitespace strings gracefully', () => {
      const result = normalizeMessage('   ');
      expect(result.normalized).toBe('');
      expect(result.tokens).toEqual([]);
      expect(result.original).toBe('   ');
    });
  });

  describe('LocalLanguageDetector', () => {
    const detector = LocalLanguageDetector.getInstance();

    test('detects Arabic language accurately with high confidence', () => {
      const samples = [
        'ازيك يا صاحبي عامل ايه؟',
        'صباح الخير يا كرافت',
        'عايز اعرف اسعار باقات الاشتراك',
        'كيف يمكنني استعادة كلمة المرور الخاصة بي؟',
      ];

      for (const text of samples) {
        const res = detector.detect(text);
        expect(res.language).toBe('ar');
        expect(res.confidence).toBeGreaterThanOrEqual(0.8);
        expect(res.isReliable).toBe(true);
      }
    });

    test('detects English language accurately', () => {
      const samples = [
        'How are you doing today?',
        'Can you please help me with my order?',
        'Hello there, what is your name?',
        'I would like to change my password',
      ];

      for (const text of samples) {
        const res = detector.detect(text);
        expect(res.language).toBe('en');
        expect(res.confidence).toBeGreaterThanOrEqual(0.7);
        expect(res.isReliable).toBe(true);
      }
    });

    test('detects French language accurately', () => {
      const samples = [
        'Bonjour comment puis-je vous aider?',
        'Merci beaucoup pour votre aide',
        'Salut avec qui puis-je parler?',
      ];

      for (const text of samples) {
        const res = detector.detect(text);
        expect(res.language).toBe('fr');
        expect(res.confidence).toBeGreaterThanOrEqual(0.7);
        expect(res.isReliable).toBe(true);
      }
    });

    test('detects Spanish language accurately', () => {
      const samples = [
        'Hola cómo estás mi amigo',
        'Muchas gracias por su ayuda',
        'Buenos días con usted por favor',
      ];

      for (const text of samples) {
        const res = detector.detect(text);
        expect(res.language).toBe('es');
        expect(res.confidence).toBeGreaterThanOrEqual(0.7);
        expect(res.isReliable).toBe(true);
      }
    });

    test('detects German language accurately', () => {
      const samples = [
        'Guten Tag wie geht es Ihnen?',
        'Hallo danke für Ihre Hilfe',
        'Ich brauche Hilfe mit meinem Passwort',
      ];

      for (const text of samples) {
        const res = detector.detect(text);
        expect(res.language).toBe('de');
        expect(res.confidence).toBeGreaterThanOrEqual(0.7);
        expect(res.isReliable).toBe(true);
      }
    });

    test('handles numbers, symbols and emoji-only strings with low confidence fallback', () => {
      const res = detector.detect('🎉🔥🚀 12345 !!!');
      expect(res.isReliable).toBe(false);
      expect(res.confidence).toBeLessThan(0.7);
    });
  });
});
