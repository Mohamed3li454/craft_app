import 'dart:io';
import 'package:craft_app/constants/craft_persona.dart';
import 'package:craft_app/features/home/data/services/web_search_service.dart';
import 'package:flutter_dotenv/flutter_dotenv.dart';
import 'package:google_generative_ai/google_generative_ai.dart';

class GeminiService {
  final WebSearchService _webSearchService;

  GeminiService({WebSearchService? webSearchService})
      : _webSearchService = webSearchService ?? WebSearchService();

  String get _apiKey => dotenv.env['API_KEY'] ?? '';
  String get _modelName => dotenv.env['GEMINI_MODEL'] ?? 'gemini-3.8-flash';
  String get _fallbackModelName =>
      dotenv.env['GEMINI_FALLBACK_MODEL'] ?? 'gemini-3.1-flash-lite';

  Future<String> generateTextResponse(String history) async {
    String prompt = history;

    if (_webSearchService.shouldSearchWeb(history)) {
      try {
        final searchResults = await _webSearchService.search(history);
        if (searchResults.isNotEmpty) {
          final searchContext =
              _webSearchService.formatSearchContext(searchResults);
          prompt = '$searchContext\nسؤال المستخدم:\n$history';
        }
      } catch (_) {
        // Fall back gracefully to standard prompt if search fails
      }
    }

    return _generate([Content.text(prompt)]);
  }

  Future<String> generateImageResponse(String history, String imagePath) async {
    final imageBytes = await File(imagePath).readAsBytes();
    final mimeType = _getMimeType(imagePath);
    return _generate([
      Content.multi([
        if (history.trim().isNotEmpty) TextPart(history),
        DataPart(mimeType, imageBytes),
      ]),
    ]);
  }

  String _getMimeType(String path) {
    final ext = path.split('.').last.toLowerCase();
    switch (ext) {
      case 'png':
        return 'image/png';
      case 'webp':
        return 'image/webp';
      case 'gif':
        return 'image/gif';
      case 'heic':
      case 'heif':
        return 'image/heic';
      case 'jpg':
      case 'jpeg':
      default:
        return 'image/jpeg';
    }
  }

  Future<String> _generate(List<Content> content) async {
    _ensureApiKey();
    try {
      return await _generateWithModel(_modelName, content);
    } catch (error) {
      if (!shouldUseFallback(error) || _fallbackModelName == _modelName) {
        rethrow;
      }
      try {
        return await _generateWithModel(_fallbackModelName, content);
      } catch (fallbackError) {
        // If fallback also fails, throw original or detailed error
        throw Exception(
          'Primary ($_modelName) and Fallback ($_fallbackModelName) both failed: $error',
        );
      }
    }
  }

  Future<String> _generateWithModel(
    String modelName,
    List<Content> content,
  ) async {
    final model = GenerativeModel(
      model: modelName,
      apiKey: _apiKey,
      systemInstruction: Content.system(CraftPersona.systemInstruction),
    );
    final response = await model.generateContent(content);

    if (response.text != null && response.text!.isNotEmpty) {
      return response.text!;
    }
    throw Exception('Empty response received from AI.');
  }

  void _ensureApiKey() {
    if (_apiKey.isEmpty) {
      throw Exception('API key not configured. Check .env file.');
    }
  }

  static bool shouldUseFallback(Object error) {
    return isQuotaOrRateLimit(error) ||
        isModelUnavailable(error) ||
        isServerOverloadedOrUnavailable(error);
  }

  static bool isServerOverloadedOrUnavailable(Object error) {
    final message = error.toString().toLowerCase();
    return message.contains('503') ||
        message.contains('500') ||
        message.contains('unavailable') ||
        message.contains('high demand') ||
        message.contains('overloaded') ||
        message.contains('temporarily') ||
        message.contains('deadline_exceeded');
  }

  static bool isQuotaOrRateLimit(Object error) {
    final message = error.toString().toLowerCase();
    return message.contains('resource_exhausted') ||
        message.contains('quota') ||
        message.contains('rate limit') ||
        message.contains('too many requests') ||
        message.contains('429');
  }

  static bool isModelUnavailable(Object error) {
    final message = error.toString().toLowerCase();
    return message.contains('no longer available') ||
        message.contains('not found') ||
        message.contains('is not supported');
  }
}
