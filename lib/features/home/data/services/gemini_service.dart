import 'dart:io';
import 'package:flutter_dotenv/flutter_dotenv.dart';
import 'package:google_generative_ai/google_generative_ai.dart';

/// Service for remote interactions with Google Gemini Generative AI.
class GeminiService {
  String get _apiKey => dotenv.env['API_KEY'] ?? '';
  String get _modelName => dotenv.env['GEMINI_MODEL'] ?? 'gemini-1.5-flash';

  Future<String> generateTextResponse(String history) async {
    if (_apiKey.isEmpty) {
      throw Exception('API key not configured. Check .env file.');
    }

    final model = GenerativeModel(
      model: _modelName,
      apiKey: _apiKey,
    );

    final content = [Content.text(history)];
    final response = await model.generateContent(content);

    if (response.text != null && response.text!.isNotEmpty) {
      return response.text!;
    } else {
      throw Exception('Empty response received from AI.');
    }
  }

  Future<String> generateImageResponse(String history, String imagePath) async {
    if (_apiKey.isEmpty) {
      throw Exception('API key not configured. Check .env file.');
    }

    final imageBytes = await File(imagePath).readAsBytes();
    final model = GenerativeModel(
      model: _modelName,
      apiKey: _apiKey,
    );

    final content = [
      Content.multi([
        TextPart(history),
        DataPart('image/jpeg', imageBytes),
      ]),
    ];

    final response = await model.generateContent(content);

    if (response.text != null && response.text!.isNotEmpty) {
      return response.text!;
    } else {
      throw Exception('Empty response received from AI.');
    }
  }
}
