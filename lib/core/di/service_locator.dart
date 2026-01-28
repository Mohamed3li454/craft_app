import 'package:craft_app/core/utils/api_service.dart';
import 'package:craft_app/core/utils/dio_factory.dart';
import 'package:craft_app/features/home/data/repos/home_repo.dart';
import 'package:craft_app/features/home/data/repos/home_repo_impl.dart';
import 'package:craft_app/features/home/data/services/chat_local_service.dart';
import 'package:craft_app/features/home/data/services/gemini_service.dart';

/// Lightweight ServiceLocator registry initialized at app startup.
class ServiceLocator {
  ServiceLocator._();

  static late final ApiService apiService;
  static late final ChatLocalService chatLocalService;
  static late final GeminiService geminiService;
  static late final HomeRepo homeRepo;

  static void init() {
    apiService = ApiService(DioFactory.dio);
    chatLocalService = ChatLocalService();
    geminiService = GeminiService();
    homeRepo = HomeRepoImpl(
      geminiService: geminiService,
      chatLocalService: chatLocalService,
    );
  }
}
