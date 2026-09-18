import 'package:dartz/dartz.dart';
import 'package:dio/dio.dart';
import 'package:craft_app/core/errors/failure.dart';
import 'package:craft_app/features/home/data/models/chat_message_model.dart';
import 'package:craft_app/features/home/data/repos/home_repo.dart';
import 'package:craft_app/features/home/data/services/ai_remote_service.dart';
import 'package:craft_app/features/home/data/services/chat_local_service.dart';

/// Concrete implementation of HomeRepo orchestrating remote AI and local cache operations.
class HomeRepoImpl implements HomeRepo {
  final AiRemoteService aiRemoteService;
  final ChatLocalService chatLocalService;

  HomeRepoImpl({
    required AiRemoteService geminiService,
    required this.chatLocalService,
  }) : aiRemoteService = geminiService;

  @override
  Future<Either<Failure, String>> getBotResponse(String history) async {
    try {
      final response = await aiRemoteService.generateTextResponse(history);
      return right(response);
    } catch (e) {
      if (e is Failure) return left(e);
      if (e is DioException) return left(ServerFailure.fromDioError(e));
      return left(ServerFailure(
        e.toString().split('\n').first.replaceFirst('Exception: ', ''),
      ));
    }
  }

  @override
  Future<Either<Failure, String>> getBotResponseWithImage(
    String history,
    String imagePath,
  ) async {
    try {
      final response =
          await aiRemoteService.generateImageResponse(history, imagePath);
      return right(response);
    } catch (e) {
      if (e is Failure) return left(e);
      if (e is DioException) return left(ServerFailure.fromDioError(e));
      return left(ServerFailure(
        e.toString().split('\n').first.replaceFirst('Exception: ', ''),
      ));
    }
  }

  @override
  Future<Either<Failure, List<ChatMessageModel>>> loadCachedMessages() async {
    try {
      final messages = await chatLocalService.loadCachedMessages();
      return right(messages);
    } catch (e) {
      return left(const CacheFailure('Failed to load cached messages.'));
    }
  }

  @override
  Future<Either<Failure, void>> cacheMessages(
    List<ChatMessageModel> messages,
  ) async {
    try {
      await chatLocalService.cacheMessages(messages);
      return right(null);
    } catch (e) {
      return left(const CacheFailure('Failed to cache messages.'));
    }
  }

  @override
  Future<Either<Failure, List<List<ChatMessageModel>>>> getOldChats() async {
    try {
      final oldChats = await chatLocalService.getOldChats();
      return right(oldChats);
    } catch (e) {
      return left(const CacheFailure('Failed to load chat history.'));
    }
  }

  @override
  Future<Either<Failure, void>> saveOldChats(
    List<List<ChatMessageModel>> oldChats,
  ) async {
    try {
      await chatLocalService.saveOldChats(oldChats);
      return right(null);
    } catch (e) {
      return left(const CacheFailure('Failed to save chat history.'));
    }
  }

  @override
  Future<Either<Failure, void>> clearCurrentChat() async {
    try {
      await chatLocalService.clearCurrentChat();
      return right(null);
    } catch (e) {
      return left(const CacheFailure('Failed to clear current chat.'));
    }
  }
}
