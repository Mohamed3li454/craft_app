import 'package:craft_app/core/utils/api_service.dart';
import 'package:craft_app/features/home/data/services/ai_remote_service.dart';
import 'package:flutter_dotenv/flutter_dotenv.dart';

/// Remote AI service implementation that routes chat queries to the Craft Backend API.
/// This fulfills the architectural goal of keeping secrets and AI models outside of Flutter.
class BackendAiService implements AiRemoteService {
  final ApiService _apiService;

  BackendAiService({required ApiService apiService}) : _apiService = apiService;

  String get baseUrl {
    final raw = dotenv.isInitialized
        ? (dotenv.env['BACKEND_BASE_URL'] ??
            'https://craft-agent-backend.vercel.app/api/v1')
        : 'https://craft-agent-backend.vercel.app/api/v1';
    final trimmed = raw.trim();
    if (trimmed.endsWith('/api/v1')) return trimmed;
    if (trimmed.endsWith('/')) return '${trimmed}api/v1';
    return '$trimmed/api/v1';
  }

  @override
  Future<String> generateTextResponse(String history) async {
    final response = await _apiService.postData(
      endPoint: '$baseUrl/chat',
      data: {
        'message': history,
      },
    );
    return response['reply']?.toString() ??
        response['text']?.toString() ??
        '';
  }

  @override
  Future<String> generateImageResponse(String history, String imagePath) async {
    final response = await _apiService.postData(
      endPoint: '$baseUrl/chat/vision',
      data: {
        'message': history,
        'imagePath': imagePath,
      },
    );
    return response['reply']?.toString() ??
        response['text']?.toString() ??
        '';
  }
}
