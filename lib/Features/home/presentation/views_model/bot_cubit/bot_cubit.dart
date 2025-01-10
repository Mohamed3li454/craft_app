// ignore_for_file: unnecessary_null_comparison, avoid_print, non_constant_identifier_names

import 'dart:io';

import 'package:craft_app/Features/home/presentation/views_model/bot_cubit/bot_state.dart';

import 'package:craft_app/conests.dart';
import 'package:dash_chat_2/dash_chat_2.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:google_generative_ai/google_generative_ai.dart';
import 'package:image_picker/image_picker.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'dart:convert';
import 'package:flutter_dotenv/flutter_dotenv.dart';

class BotCubit extends Cubit<BotState> {
  BotCubit() : super(BotInitial()) {
    _loadMessagesFromCache();
  }

  final _user = ChatUser(id: "1", firstName: "Mohamed");
  final _bot = ChatUser(id: "2", firstName: "Craft");
  final List<ChatMessage> _messages = [];
  List<ChatMessage> get messages => _messages;
  int? currentChatIndex;
  String api_key = dotenv.env['API_KEY'] ?? '';

  String get _chatHistory {
    return _messages.reversed.map((msg) => " ${msg.text}").join("\n");
  }

  Future<void> _cacheMessages() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      List<String> messagesJson =
          _messages.map((msg) => json.encode(msg.toJson())).toList();
      await prefs.setStringList('current_chat_messages', messagesJson);
      print('Messages cached successfully: ${messagesJson.length} messages');
    } catch (e) {
      print('Error caching messages: $e');
    }
  }

  Future<void> _loadMessagesFromCache() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      List<String>? messagesJson = prefs.getStringList('current_chat_messages');

      if (messagesJson != null && messagesJson.isNotEmpty) {
        _messages.clear();
        _messages.addAll(
            messagesJson.map((msg) => ChatMessage.fromJson(json.decode(msg))));
        print('Loaded ${_messages.length} messages from cache');
      } else {
        print('No cached messages found');
      }

      emit(BotMessageSent(List.from(_messages)));
    } catch (e) {
      print('Error loading messages from cache: $e');
      emit(BotError('Failed to load previous messages'));
    }
  }

  Future<void> saveCurrentChatBeforeExit() async {
    if (_messages.isNotEmpty) {
      await _cacheMessages();
      print('Chat saved before exit');
    }
  }

  void addUserMessage(ChatMessage message) {
    _messages.insert(0, message);
    emit(BotMessageSent(List.from(_messages)));
    _cacheMessages();
  }

  Future<void> sendMessage(String userText) async {
    final userMessage = ChatMessage(
      user: _user,
      createdAt: DateTime.now(),
      text: userText,
    );

    _messages.insert(0, userMessage);
    emit(BotMessageSent(List.from(_messages)));

    await _cacheMessages();
    await _getBotResponse();
  }

  Future<void> _getBotResponse() async {
    emit(BotWaitingForResponse(List.from(_messages)));

    try {
      final model =
          GenerativeModel(model: 'gemini-2.0-flash-exp', apiKey: api_key);
      final content = [Content.text(_chatHistory)];
      final response = await model.generateContent(content);

      if (response != null && response.text != null) {
        final botMessage = ChatMessage(
            user: _bot, createdAt: DateTime.now(), text: response.text!);
        _messages.insert(0, botMessage);
        emit(BotMessageSent(List.from(_messages)));
        await _cacheMessages();
      } else {
        emit(BotError("Error in bot response."));
      }
    } catch (e) {
      emit(BotError("Failed to get bot response."));
    }
  }

  Future<void> sendImage(String imagePath) async {
    final imageMessage = ChatMessage(
      user: _user,
      createdAt: DateTime.now(),
      customProperties: {'image': imagePath},
    );

    _messages.insert(0, imageMessage);
    emit(BotMessageSent(List.from(_messages)));

    await _cacheMessages();
    await _getBotResponseWithImage(imagePath);
  }

  Future<void> _getBotResponseWithImage(String imagePath) async {
    emit(BotWaitingForResponse(List.from(_messages)));

    try {
      final imageBytes = await File(imagePath).readAsBytes();

      final model = GenerativeModel(
        model: 'gemini-2.0-flash-exp',
        apiKey: api_key,
      );

      final content = [
        Content.multi(
            [TextPart(_chatHistory), DataPart('image/jpeg', imageBytes)])
      ];

      final response = await model.generateContent(content);

      if (response != null && response.text != null) {
        final botMessage = ChatMessage(
            user: _bot, createdAt: DateTime.now(), text: response.text!);
        _messages.insert(0, botMessage);
        emit(BotMessageSent(List.from(_messages)));
        await _cacheMessages();
      } else {
        emit(BotError("Error in bot response."));
      }
    } catch (e) {
      emit(BotError("Failed to get response from bot with image: $e"));
    }
  }

  void setCurrentChatIndex(int index) {
    currentChatIndex = index;
  }

  Future<void> clearChatCache(int? chatIndex) async {
    final prefs = await SharedPreferences.getInstance();

    List<String>? oldChats = prefs.getStringList('old_chats') ?? [];

    if (chatIndex != null && chatIndex >= 0 && chatIndex < oldChats.length) {
      oldChats.removeAt(chatIndex);

      await prefs.setStringList('old_chats', oldChats);
    }

    _messages.clear();
    await prefs.remove('current_chat_messages');

    currentChatIndex = null;

    emit(BotMessageSent([]));
  }

  Future<void> startNewChat() async {
    final prefs = await SharedPreferences.getInstance();
    List<String>? oldChats = prefs.getStringList('old_chats') ?? [];

    if (_messages.isNotEmpty) {
      List<Map<String, dynamic>> currentChatJson =
          _messages.map((msg) => msg.toJson()).toList();
      oldChats.add(json.encode(currentChatJson));
      await prefs.setStringList('old_chats', oldChats);
    }

    _messages.clear();

    await prefs.remove('current_chat_messages');

    emit(BotMessageSent([]));
  }

  Future<List<List<ChatMessage>>> getOldChats() async {
    final prefs = await SharedPreferences.getInstance();
    List<String>? oldChats = prefs.getStringList('old_chats') ?? [];

    try {
      return oldChats.map((chatJson) {
        List<dynamic> chatList = json.decode(chatJson) as List<dynamic>;
        return chatList
            .map((msgJson) =>
                ChatMessage.fromJson(msgJson as Map<String, dynamic>))
            .toList();
      }).toList();
    } catch (e) {
      print("Error decoding old chats: $e");
      return [];
    }
  }

  Future<void> loadOldChat(int index) async {
    final prefs = await SharedPreferences.getInstance();
    List<String>? oldChats = prefs.getStringList('old_chats') ?? [];

    if (index < oldChats.length) {
      try {
        List<dynamic> decodedChat = json.decode(oldChats[index]);
        List<ChatMessage> oldChat = decodedChat
            .map((msgJson) =>
                ChatMessage.fromJson(msgJson as Map<String, dynamic>))
            .toList();

        if (_messages.isNotEmpty) {
          List<Map<String, dynamic>> currentChatJson =
              _messages.map((msg) => msg.toJson()).toList();
          oldChats.add(json.encode(currentChatJson));
        }

        _messages.clear();
        _messages.addAll(oldChat);

        oldChats.removeAt(index);

        await prefs.setStringList('old_chats', oldChats);

        await _cacheMessages();

        emit(BotMessageSent(List.from(_messages)));
      } catch (e) {
        emit(BotError("Failed to load chat: ${e.toString()}"));
      }
    }
  }
}

class ImagePickerCubit extends Cubit<BotState> {
  ImagePickerCubit() : super(BotInitial());
  final ImagePicker _picker = ImagePicker();
  final _user = ChatUser(id: "1", firstName: "Mohamed");

  Future<void> pickImage() async {
    emit(BotLoading());
    final statuses = await [Permission.camera].request();

    if (statuses[Permission.camera]!.isGranted) {
      final pickedFile = await _picker.pickImage(source: ImageSource.gallery);

      if (pickedFile != null) {
        emit(BotMessageSent([
          ChatMessage(
              user: _user,
              createdAt: DateTime.now(),
              customProperties: {'image': pickedFile.path})
        ]));
      } else {
        emit(BotError("No image selected."));
      }
    } else {
      emit(BotError("Permission denied."));
    }
  }
}
