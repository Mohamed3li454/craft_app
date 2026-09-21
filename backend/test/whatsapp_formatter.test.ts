import {
  cleanWhatsAppText,
  convertMarkdownTablesToWhatsApp,
  splitWhatsAppMessage,
} from '../src/modules/whatsapp/formatter';
import { WhatsAppAdapter } from '../src/modules/whatsapp/adapter';

describe('WhatsApp Formatter & Multi-Message Splitting Suite', () => {
  describe('convertMarkdownTablesToWhatsApp', () => {
    test('converts multi-column comparison table into elegant bullet points', () => {
      const markdownTable = `
| الخاصية | iPhone 18 | iPhone 18 Pro |
|---|---|---|
| الشاشة | 6.1 بوصة OLED | 6.7 بوصة OLED |
| المعالج | A20 Bionic | A20 Pro |
`;
      const result = convertMarkdownTablesToWhatsApp(markdownTable);

      expect(result).not.toContain('|');
      expect(result).not.toContain('---');
      expect(result).toContain('📌 *الشاشة*:');
      expect(result).toContain('*iPhone 18*: 6.1 بوصة OLED');
      expect(result).toContain('*iPhone 18 Pro*: 6.7 بوصة OLED');
      expect(result).toContain('📌 *المعالج*:');
    });

    test('converts simple 2-column table into clean key-value bullets', () => {
      const simpleTable = `
| الموديل | السعر التقريبي |
|---|---|
| iPhone 16 | 45000 ج.م |
| iPhone 16 Pro | 60000 ج.م |
`;
      const result = convertMarkdownTablesToWhatsApp(simpleTable);

      expect(result).not.toContain('|');
      expect(result).toContain('• *iPhone 16*: 45000 ج.م');
      expect(result).toContain('• *iPhone 16 Pro*: 60000 ج.م');
    });

    test('leaves regular text without tables untouched', () => {
      const normalText = 'مرحباً بك يا هندسة، هذا نص عادي بدون أي جداول.';
      expect(convertMarkdownTablesToWhatsApp(normalText)).toBe(normalText);
    });
  });

  describe('cleanWhatsAppText', () => {
    test('removes <br> tags and converts to clean newlines', () => {
      const textWithBrs = 'سطر أول<br>سطر ثاني<br />سطر ثالث';
      const cleaned = cleanWhatsAppText(textWithBrs);

      expect(cleaned).not.toContain('<br');
      expect(cleaned).toContain('سطر أول\nسطر ثاني\nسطر ثالث');
    });

    test('converts HTML tags (b, i, strong) to WhatsApp symbols', () => {
      const htmlText = 'هذا النص <b>عريض جداً</b> و <i>مائل</i>.';
      const cleaned = cleanWhatsAppText(htmlText);

      expect(cleaned).toContain('*عريض جداً*');
      expect(cleaned).toContain('_مائل_');
      expect(cleaned).not.toContain('<b>');
      expect(cleaned).not.toContain('<i>');
    });

    test('converts markdown headers and double asterisks to WhatsApp bold', () => {
      const mdText = '## عنوان رئيسي\n\nهذا **نص مهم جداً** في الشرح.';
      const cleaned = cleanWhatsAppText(mdText);

      expect(cleaned).toContain('*عنوان رئيسي*');
      expect(cleaned).toContain('*نص مهم جداً*');
      expect(cleaned).not.toContain('##');
      expect(cleaned).not.toContain('**');
    });

    test('preserves code blocks without corrupting them', () => {
      const codeBlock = '```dart\nvoid main() {\n  print("Hello");\n}\n```';
      const text = `إليك الكود المطلوب:\n\n${codeBlock}\n\nأتمنى يفيدك!`;
      const cleaned = cleanWhatsAppText(text);

      expect(cleaned).toContain(codeBlock);
    });
  });

  describe('splitWhatsAppMessage', () => {
    test('keeps short messages as a single chunk', () => {
      const shortMsg = 'أهلاً يا هندسة! الساعة الآن 4:30 مساءً في القاهرة.';
      const chunks = splitWhatsAppMessage(shortMsg);

      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toBe(shortMsg);
    });

    test('splits a long structured message into 2 or 3 readable messages', () => {
      const section1 = 'فقرة أولى: '.padEnd(500, 'تفاصيل ومواصفات مهمة ');
      const section2 = 'فقرة ثانية: '.padEnd(500, 'مقارنات وأسعار واضحة ');
      const section3 = 'فقرة ثالثة: '.padEnd(500, 'خلاصة ونصائح نهائية للمستخدم ');

      const longText = `${section1}\n\n${section2}\n\n${section3}`;
      const chunks = splitWhatsAppMessage(longText);

      expect(chunks.length).toBeGreaterThanOrEqual(2);
      expect(chunks.length).toBeLessThanOrEqual(3);

      // Verify each chunk is trimmed and non-empty
      for (const chunk of chunks) {
        expect(chunk.trim().length).toBeGreaterThan(0);
      }
    });

    test('splits user iPhone specs sample cleanly into 2 readable messages', () => {
      const sample = `
## أحدث مواصفات iPhone 18 Pro و iPhone 18 Pro Max (2026)

*ملاحظة*: المواصفات دي مأخوذة من آخر تحديثات Apple ومواقع التقنية العالمية (TechRadar, The Verge, Apple newsroom) لحد تاريخ 21 سبتمبر 2026. الأسعار والخيارات ممكن تختلف حسب السوق المحلي.

| الخاصية | iPhone 18 | iPhone 18 Pro |
|---|---|---|
| *الشاشة* | 6.1-إنش Super Retina XDR OLED, HDR10+, 120 Hz ProMotion | 6.7-إنش Super Retina XDR OLED, HDR10+, 120 Hz ProMotion |
| *المعالج* | A20 Bionic (5-نانومتر) + وحدة معالجة رسومات 5-core | A20 Bionic مع تحسينات في إدارة الطاقة للبطارية الكبيرة |
| *الذاكرة الداخلية* | 128 GB / 256 GB / 512 GB / 1 TB | 256 GB / 512 GB / 1 TB |
| *الكاميرا الخلفية* | نظام ثلاثي 48 MP + 12 MP زووم 3x | نظام ثلاثي 48 MP + 12 MP زووم 5x + LiDAR |

- Always-On display (مستوى سطوع منخفض) <br> - تحسينات في الـ Face ID (سرعة استجابة 0.03 ثانية) <br> - دعم الـ Satellite SOS للحالات الطارئة
`;

      const chunks = splitWhatsAppMessage(sample);

      expect(chunks.length).toBe(2);
      expect(chunks[0]).toContain('*أحدث مواصفات iPhone 18 Pro');
      expect(chunks[0]).toContain('📌 *الشاشة*:');
      expect(chunks[1]).toContain('📌 *المعالج*:');
      expect(chunks[1]).not.toContain('<br');
      expect(chunks[0]).not.toContain('|');
      expect(chunks[1]).not.toContain('|');
    });
  });

  describe('WhatsAppAdapter sendTextMessage chunking', () => {
    let adapter: WhatsAppAdapter;

    beforeEach(() => {
      adapter = new WhatsAppAdapter();
    });

    test('sendTextMessage splits long messages and sends each chunk in mock mode', async () => {
      const sendRawSpy = jest
        .spyOn(adapter, 'sendRawTextMessage')
        .mockResolvedValue(true);

      const section1 = 'الجزء الأول من الشرح: '.padEnd(600, 'معلومات ');
      const section2 = 'الجزء الثاني من الشرح: '.padEnd(600, 'تفاصيل ');
      const longMessage = `${section1}\n\n${section2}`;

      const result = await adapter.sendTextMessage('201028067432', longMessage);

      expect(result).toBe(true);
      expect(sendRawSpy.mock.calls.length).toBeGreaterThanOrEqual(2);

      sendRawSpy.mockRestore();
    });
  });
});
