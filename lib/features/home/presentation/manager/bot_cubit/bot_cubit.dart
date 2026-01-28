import 'package:equatable/equatable.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:craft_app/core/di/service_locator.dart';
import 'package:craft_app/features/home/data/models/chat_message_model.dart';
import 'package:craft_app/features/home/data/repos/home_repo.dart';

part 'bot_state.dart';

/// Business logic manager for the bot chat screen.
/// Follows constructor injection, Equatable states, and strict isClosed lifecycle protection.
class BotCubit extends Cubit<BotState> {
  final HomeRepo homeRepo;

  BotCubit({HomeRepo? homeRepo})
      : homeRepo = homeRepo ?? ServiceLocator.homeRepo,
        super(const BotInitial()) {
    loadCachedMessages();
  }

  final List<ChatMessageModel> _messages = [];
  List<ChatMessageModel> get messages => List.unmodifiable(_messages);

  int? currentChatIndex;

  String get _chatHistory {
    return _messages.reversed.map((msg) => ' ${msg.text}').join('\n');
  }

  void setCurrentChatIndex(int? index) {
    currentChatIndex = index;
  }

  Future<void> loadCachedMessages() async {
    final result = await homeRepo.loadCachedMessages();
    if (isClosed) return;

    result.fold(
      (failure) {
        if (!isClosed) emit(BotFailure(failure.errMessage));
      },
      (cachedMessages) {
        _messages.clear();
        _messages.addAll(cachedMessages);
        if (!isClosed) emit(BotMessageSent(List.from(_messages)));
      },
    );
  }

  Future<void> sendMessage(String userText) async {
    final cleanText = userText.trim();
    if (cleanText.isEmpty) return;

    final userMessage = ChatMessageModel(
      userId: '1',
      userName: 'Mohamed',
      text: cleanText,
      createdAt: DateTime.now(),
    );

    _messages.insert(0, userMessage);
    emit(BotMessageSent(List.from(_messages)));

    await homeRepo.cacheMessages(_messages);
    if (isClosed) return;

    await _fetchBotResponse();
  }

  Future<void> _fetchBotResponse() async {
    emit(BotWaitingForResponse(List.from(_messages)));

    final result = await homeRepo.getBotResponse(_chatHistory);
    if (isClosed) return;

    await result.fold(
      (failure) async {
        if (!isClosed) emit(BotFailure(failure.errMessage));
      },
      (botReply) async {
        final botMessage = ChatMessageModel(
          userId: '2',
          userName: 'Craft',
          text: botReply,
          createdAt: DateTime.now(),
        );

        _messages.insert(0, botMessage);
        await homeRepo.cacheMessages(_messages);

        if (!isClosed) {
          emit(BotMessageSent(List.from(_messages)));
        }
      },
    );
  }

  Future<void> sendImage(String imagePath) async {
    final imageMessage = ChatMessageModel(
      userId: '1',
      userName: 'Mohamed',
      text: '',
      createdAt: DateTime.now(),
      imagePath: imagePath,
    );

    _messages.insert(0, imageMessage);
    emit(BotMessageSent(List.from(_messages)));

    await homeRepo.cacheMessages(_messages);
    if (isClosed) return;

    await _fetchBotResponseWithImage(imagePath);
  }

  Future<void> _fetchBotResponseWithImage(String imagePath) async {
    emit(BotWaitingForResponse(List.from(_messages)));

    final result = await homeRepo.getBotResponseWithImage(_chatHistory, imagePath);
    if (isClosed) return;

    await result.fold(
      (failure) async {
        if (!isClosed) emit(BotFailure(failure.errMessage));
      },
      (botReply) async {
        final botMessage = ChatMessageModel(
          userId: '2',
          userName: 'Craft',
          text: botReply,
          createdAt: DateTime.now(),
        );

        _messages.insert(0, botMessage);
        await homeRepo.cacheMessages(_messages);

        if (!isClosed) {
          emit(BotMessageSent(List.from(_messages)));
        }
      },
    );
  }

  Future<void> startNewChat() async {
    if (_messages.isNotEmpty) {
      final oldChatsResult = await homeRepo.getOldChats();
      if (isClosed) return;

      final oldChats = oldChatsResult.getOrElse(() => []);
      oldChats.add(List.from(_messages));
      await homeRepo.saveOldChats(oldChats);
      if (isClosed) return;
    }

    _messages.clear();
    currentChatIndex = null;
    await homeRepo.clearCurrentChat();

    if (!isClosed) {
      emit(const BotMessageSent([]));
    }
  }

  Future<void> clearChatCache(int? chatIndex) async {
    final oldChatsResult = await homeRepo.getOldChats();
    if (isClosed) return;

    final oldChats = oldChatsResult.getOrElse(() => []);

    if (chatIndex != null && chatIndex >= 0 && chatIndex < oldChats.length) {
      oldChats.removeAt(chatIndex);
      await homeRepo.saveOldChats(oldChats);
      if (isClosed) return;
    }

    _messages.clear();
    currentChatIndex = null;
    await homeRepo.clearCurrentChat();

    if (!isClosed) {
      emit(const BotMessageSent([]));
    }
  }

  Future<List<List<ChatMessageModel>>> getOldChats() async {
    final result = await homeRepo.getOldChats();
    return result.getOrElse(() => []);
  }

  Future<void> loadOldChat(int index) async {
    final oldChatsResult = await homeRepo.getOldChats();
    if (isClosed) return;

    final oldChats = oldChatsResult.getOrElse(() => []);

    if (index >= 0 && index < oldChats.length) {
      final selectedChat = oldChats[index];

      if (_messages.isNotEmpty) {
        oldChats.add(List.from(_messages));
      }

      _messages.clear();
      _messages.addAll(selectedChat);

      oldChats.removeAt(index);
      await homeRepo.saveOldChats(oldChats);
      if (isClosed) return;

      await homeRepo.cacheMessages(_messages);
      if (isClosed) return;

      currentChatIndex = null;
      if (!isClosed) {
        emit(BotMessageSent(List.from(_messages)));
      }
    }
  }
}
