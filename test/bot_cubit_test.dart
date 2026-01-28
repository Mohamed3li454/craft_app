import 'package:dartz/dartz.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:craft_app/core/errors/failure.dart';
import 'package:craft_app/features/home/data/models/chat_message_model.dart';
import 'package:craft_app/features/home/data/repos/home_repo.dart';
import 'package:craft_app/features/home/presentation/manager/bot_cubit/bot_cubit.dart';

class FakeHomeRepo implements HomeRepo {
  List<ChatMessageModel> cachedMessages = [];
  List<List<ChatMessageModel>> oldChats = [];
  String nextBotResponse = 'Hello! How can I help you today?';
  bool shouldFail = false;

  @override
  Future<Either<Failure, String>> getBotResponse(String history) async {
    if (shouldFail) {
      return left(const ServerFailure('Network error'));
    }
    return right(nextBotResponse);
  }

  @override
  Future<Either<Failure, String>> getBotResponseWithImage(
      String history, String imagePath) async {
    if (shouldFail) {
      return left(const ServerFailure('Network error'));
    }
    return right('Image response');
  }

  @override
  Future<Either<Failure, List<ChatMessageModel>>> loadCachedMessages() async {
    return right(cachedMessages);
  }

  @override
  Future<Either<Failure, void>> cacheMessages(
      List<ChatMessageModel> messages) async {
    cachedMessages = List.from(messages);
    return right(null);
  }

  @override
  Future<Either<Failure, List<List<ChatMessageModel>>>> getOldChats() async {
    return right(oldChats);
  }

  @override
  Future<Either<Failure, void>> saveOldChats(
      List<List<ChatMessageModel>> chats) async {
    oldChats = List.from(chats);
    return right(null);
  }

  @override
  Future<Either<Failure, void>> clearCurrentChat() async {
    cachedMessages.clear();
    return right(null);
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('BotCubit Tests', () {
    late FakeHomeRepo fakeRepo;
    late BotCubit cubit;

    setUp(() {
      fakeRepo = FakeHomeRepo();
      cubit = BotCubit(homeRepo: fakeRepo);
    });

    tearDown(() {
      cubit.close();
    });

    test('initial state loads cached messages', () async {
      await Future.delayed(const Duration(milliseconds: 50));
      expect(cubit.state, isA<BotMessageSent>());
      expect(cubit.messages, isEmpty);
    });

    test('sendMessage adds user message and fetches bot response', () async {
      await Future.delayed(const Duration(milliseconds: 50));

      await cubit.sendMessage('Hello Craft');

      expect(cubit.messages.length, 2);
      expect(cubit.messages[0].isBot, isTrue);
      expect(cubit.messages[0].text, 'Hello! How can I help you today?');
      expect(cubit.messages[1].isBot, isFalse);
      expect(cubit.messages[1].text, 'Hello Craft');
      expect(cubit.state, isA<BotMessageSent>());
    });

    test('sendMessage handles failure correctly', () async {
      await Future.delayed(const Duration(milliseconds: 50));
      fakeRepo.shouldFail = true;

      await cubit.sendMessage('Hello Craft');

      expect(cubit.state, isA<BotFailure>());
      expect((cubit.state as BotFailure).errMessage, 'Network error');
    });

    test('startNewChat archives messages and clears current chat', () async {
      await Future.delayed(const Duration(milliseconds: 50));
      await cubit.sendMessage('First message');

      await cubit.startNewChat();

      expect(cubit.messages, isEmpty);
      expect(fakeRepo.oldChats.length, 1);
    });
  });
}
