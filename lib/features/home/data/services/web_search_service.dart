import 'package:dio/dio.dart';
import 'package:flutter_dotenv/flutter_dotenv.dart';

/// Represents a single search result item.
class SearchResultItem {
  final String title;
  final String snippet;

  const SearchResultItem({
    required this.title,
    required this.snippet,
  });

  @override
  String toString() => '- العنوان: $title\n  المحتوى: $snippet';
}

/// Service that performs live web searches to ground AI answers with current facts and news.
class WebSearchService {
  final Dio _dio;

  WebSearchService({Dio? dio})
      : _dio = dio ??
            Dio(
              BaseOptions(
                connectTimeout: const Duration(seconds: 5),
                receiveTimeout: const Duration(seconds: 5),
                sendTimeout: const Duration(seconds: 5),
                headers: {
                  'User-Agent':
                      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                  'Accept':
                      'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                  'Accept-Language': 'ar,en-US;q=0.9,en;q=0.8',
                },
              ),
            );

  static final List<String> _timeSensitiveKeywords = [
    'أخبار',
    'اخبار',
    'خبر',
    'اليوم',
    'النهاردة',
    'امس',
    'أمس',
    'غدا',
    'غداً',
    'بكرة',
    'سعر',
    'أسعار',
    'اسعار',
    'دولار',
    'ذهب',
    'طقس',
    'الطقس',
    'درجة الحرارة',
    'مباراة',
    'مباريات',
    'نتيجة',
    'دوري',
    'كأس',
    'أحدث',
    'احدث',
    'جديد',
    'تريند',
    'آخر',
    'اخر',
    'حالياً',
    'حاليا',
    'الآن',
    'الان',
    'news',
    'today',
    'latest',
    'current',
    'recent',
    'weather',
    'price',
    'score',
    'match',
    'trend',
    'now',
  ];

  /// Checks if a query is time-sensitive and requires live web search.
  bool shouldSearchWeb(String query) {
    final lower = query.toLowerCase();
    return _timeSensitiveKeywords.any((keyword) => lower.contains(keyword));
  }

  /// Searches the web for relevant snippets.
  /// Falls back gracefully to an empty list on failure or timeout.
  Future<List<SearchResultItem>> search(String query, {int maxResults = 3}) async {
    final cleanQuery = query.trim();
    if (cleanQuery.isEmpty) return [];

    final tavilyKey = dotenv.env['TAVILY_API_KEY'] ?? '';
    if (tavilyKey.isNotEmpty) {
      try {
        final tavilyResults = await _searchTavily(cleanQuery, tavilyKey, maxResults);
        if (tavilyResults.isNotEmpty) return tavilyResults;
      } catch (_) {
        // Fall back to DuckDuckGo if Tavily fails
      }
    }

    return _searchDuckDuckGo(cleanQuery, maxResults);
  }

  Future<List<SearchResultItem>> _searchTavily(
    String query,
    String apiKey,
    int maxResults,
  ) async {
    final response = await _dio.post(
      'https://api.tavily.com/search',
      data: {
        'api_key': apiKey,
        'query': query,
        'search_depth': 'basic',
        'max_results': maxResults,
      },
      options: Options(
        headers: {'Content-Type': 'application/json'},
      ),
    );

    if (response.statusCode == 200 && response.data is Map) {
      final results = response.data['results'] as List?;
      if (results != null) {
        return results.map((item) {
          final title = (item['title'] ?? '').toString();
          final content = (item['content'] ?? '').toString();
          return SearchResultItem(title: title, snippet: content);
        }).toList();
      }
    }
    return [];
  }

  Future<List<SearchResultItem>> _searchDuckDuckGo(
    String query,
    int maxResults,
  ) async {
    try {
      final response = await _dio.post(
        'https://html.duckduckgo.com/html/',
        data: {'q': query},
        options: Options(
          contentType: Headers.formUrlEncodedContentType,
          responseType: ResponseType.plain,
        ),
      );

      final html = response.data.toString();
      return _extractDuckDuckGoResults(html, maxResults);
    } catch (_) {
      return [];
    }
  }

  List<SearchResultItem> _extractDuckDuckGoResults(String html, int maxResults) {
    final titleMatches = RegExp(
      r'<h2 class="result__title">\s*<a[^>]*>(.*?)</a>',
      dotAll: true,
    ).allMatches(html).toList();

    final snippetMatches = RegExp(
      r'<a class="result__snippet[^"]*"[^>]*>(.*?)</a>',
      dotAll: true,
    ).allMatches(html).toList();

    final count = [titleMatches.length, snippetMatches.length, maxResults]
        .reduce((a, b) => a < b ? a : b);

    final results = <SearchResultItem>[];
    for (int i = 0; i < count; i++) {
      final rawTitle = titleMatches[i].group(1) ?? '';
      final rawSnippet = snippetMatches[i].group(1) ?? '';

      final title = _cleanHtml(rawTitle);
      final snippet = _cleanHtml(rawSnippet);

      if (snippet.isNotEmpty) {
        results.add(SearchResultItem(title: title, snippet: snippet));
      }
    }
    return results;
  }

  String _cleanHtml(String text) {
    return text
        .replaceAll(RegExp(r'<[^>]+>'), '')
        .replaceAll('&quot;', '"')
        .replaceAll('&amp;', '&')
        .replaceAll('&#39;', "'")
        .replaceAll('&lt;', '<')
        .replaceAll('&gt;', '>')
        .replaceAll(RegExp(r'\s+'), ' ')
        .trim();
  }

  /// Formats search results into a clean context block for Gemini grounding.
  String formatSearchContext(List<SearchResultItem> items) {
    if (items.isEmpty) return '';
    final buffer = StringBuffer();
    buffer.writeln('[معلومات حية من بحث الويب المباشر لهذا اليوم]:');
    for (int i = 0; i < items.length; i++) {
      buffer.writeln('${i + 1}. العنوان: ${items[i].title}');
      buffer.writeln('   الملخص: ${items[i].snippet}');
    }
    buffer.writeln();
    return buffer.toString();
  }
}
