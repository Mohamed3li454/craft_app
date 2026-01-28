import 'package:dartz/dartz.dart';
import 'package:craft_app/core/errors/failure.dart';
import 'package:craft_app/features/home/data/models/chat_message_model.dart';

/// Repository contract for the Home & Bot feature.
/// Returns `Either<Failure, T>` for functional, compiler-checked error handling.
abstract class HomeRepo {
  Future<Either<Failure, String>> getBotResponse(String history);
  Future<Either<Failure, String>> getBotResponseWithImage(String history, String imagePath);
  Future<Either<Failure, List<ChatMessageModel>>> loadCachedMessages();
  Future<Either<Failure, void>> cacheMessages(List<ChatMessageModel> messages);
  Future<Either<Failure, List<List<ChatMessageModel>>>> getOldChats();
  Future<Either<Failure, void>> saveOldChats(List<List<ChatMessageModel>> oldChats);
  Future<Either<Failure, void>> clearCurrentChat();
}
