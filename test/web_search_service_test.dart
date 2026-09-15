import 'package:flutter_test/flutter_test.dart';
import 'package:craft_app/features/home/data/services/web_search_service.dart';

void main() {
  group('WebSearchService Tests', () {
    late WebSearchService service;

    setUp(() {
      service = WebSearchService();
    });

    test('shouldSearchWeb correctly identifies time-sensitive queries', () {
      expect(service.shouldSearchWeb('ما هي أحدث أخبار اليوم؟'), isTrue);
      expect(service.shouldSearchWeb('سعر الذهب اليوم في مصر'), isTrue);
      expect(service.shouldSearchWeb('طقس الإسكندرية غداً'), isTrue);
      expect(service.shouldSearchWeb('What are the latest news today?'), isTrue);
      expect(service.shouldSearchWeb('Current dollar price trend'), isTrue);
    });

    test('shouldSearchWeb returns false for timeless and static queries', () {
      expect(service.shouldSearchWeb('ما هي عاصمة فرنسا؟'), isFalse);
      expect(service.shouldSearchWeb('اشرح لي خوارزمية Binary Search'), isFalse);
      expect(service.shouldSearchWeb('اكتب لي قصيدة عن الصداقة'), isFalse);
      expect(service.shouldSearchWeb('How do I center a div in CSS?'), isFalse);
    });

    test('formatSearchContext formats items into clean markdown block', () {
      final items = [
        const SearchResultItem(
          title: 'الأهرام اليومية',
          snippet: 'أهم التطورات السياسية والاقتصادية اليوم.',
        ),
        const SearchResultItem(
          title: 'اليوم السابع',
          snippet: 'استقرار أسعار السلع في الأسواق.',
        ),
      ];

      final formatted = service.formatSearchContext(items);
      expect(formatted, contains('[معلومات حية ومفصلة من بحث الويب المباشر لهذا اليوم]:'));
      expect(formatted, contains('الأهرام اليومية'));
      expect(formatted, contains('اليوم السابع'));
    });

    test('formatSearchContext returns empty string for empty list', () {
      expect(service.formatSearchContext([]), isEmpty);
    });

    test('search returns empty list for empty query', () async {
      final results = await service.search('   ');
      expect(results, isEmpty);
    });
  });
}
