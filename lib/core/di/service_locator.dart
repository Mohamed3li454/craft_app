import 'package:craft_app/core/utils/api_service.dart';
import 'package:craft_app/core/utils/dio_factory.dart';
import 'package:craft_app/features/home/data/repos/home_repo.dart';
import 'package:craft_app/features/home/data/repos/home_repo_impl.dart';
import 'package:craft_app/features/home/data/services/ai_remote_service.dart';
import 'package:craft_app/features/home/data/services/backend_ai_service.dart';
import 'package:craft_app/features/home/data/services/chat_local_service.dart';
import 'package:craft_app/features/home/data/services/gemini_service.dart';
import 'package:craft_app/features/home/data/services/web_search_service.dart';
import 'package:flutter_dotenv/flutter_dotenv.dart';

/// Lightweight ServiceLocator registry initialized at app startup.
class ServiceLocator {
  ServiceLocator._();

  static late final ApiService apiService;
  static late final ChatLocalService chatLocalService;
  static late final WebSearchService webSearchService;
  static late final GeminiService geminiService;
  static late final AiRemoteService aiRemoteService;
  static late final HomeRepo homeRepo;

  static void init() {
    apiService = ApiService(DioFactory.dio);
    chatLocalService = ChatLocalService();
    webSearchService = WebSearchService();
    geminiService = GeminiService(webSearchService: webSearchService);

    final backendUrl =
        dotenv.isInitialized ? dotenv.env['BACKEND_BASE_URL'] : null;
    if (backendUrl != null && backendUrl.trim().isNotEmpty) {
      aiRemoteService = BackendAiService(apiService: apiService);
    } else {
      aiRemoteService = geminiService;
    }

    homeRepo = HomeRepoImpl(
      geminiService: aiRemoteService,
      chatLocalService: chatLocalService,
    );
  }
}
