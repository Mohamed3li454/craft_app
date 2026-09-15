import 'dart:io';
import 'package:craft_app/constants/craft_persona.dart';
import 'package:flutter_dotenv/flutter_dotenv.dart';
import 'package:google_generative_ai/google_generative_ai.dart';

class GeminiService {
  String get _apiKey => dotenv.env['API_KEY'] ?? '';
  String get _modelName => dotenv.env['GEMINI_MODEL'] ?? 'gemini-2.5-flash';
  String get _fallbackModelName =>
      dotenv.env['GEMINI_FALLBACK_MODEL'] ?? 'gemini-2.5-flash-lite';

  Future<String> generateTextResponse(String history) {
    return _generate([Content.text(history)]);
  }

  Future<String> generateImageResponse(String history, String imagePath) async {
    final imageBytes = await File(imagePath).readAsBytes();
    return _generate([
      Content.multi([
        TextPart(history),
        DataPart('image/jpeg', imageBytes),
      ]),
    ]);
  }

  Future<String> _generate(List<Content> content) async {
    _ensureApiKey();
    try {
      return await _generateWithModel(_modelName, content);
    } catch (error) {
      if (!isQuotaOrRateLimit(error) || _fallbackModelName == _modelName) {
        rethrow;
      }
      return _generateWithModel(_fallbackModelName, content);
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

  static bool isQuotaOrRateLimit(Object error) {
    final message = error.toString().toLowerCase();
    return message.contains('resource_exhausted') ||
        message.contains('quota') ||
        message.contains('rate limit') ||
        message.contains('too many requests') ||
        message.contains('429');
  }
}
