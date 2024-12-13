// ignore_for_file: unnecessary_null_comparison

import 'package:craft_app/Features/home/presentation/views_model/bot_cubit/bot_state.dart';
import 'package:craft_app/conests.dart';
import 'package:dash_chat_2/dash_chat_2.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_tesseract_ocr/android_ios.dart';
import 'package:google_generative_ai/google_generative_ai.dart';
import 'package:image_picker/image_picker.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'dart:convert';

class BotCubit extends Cubit<BotState> {
  BotCubit() : super(BotInitial()) {
    _loadMessagesFromCache(); // تحميل الرسائل عند بداية الـ Cubit
  }

  final _user = ChatUser(id: "1", firstName: "Mohamed");
  final _bot = ChatUser(id: "2", firstName: "Craft");
  final List<ChatMessage> _messages = [];
  int? currentChatIndex;

  String get _chatHistory {
    return _messages.reversed.map((msg) => " ${msg.text}").join("\n");
  }

  // تخزين الرسائل في SharedPreferences
  Future<void> _cacheMessages() async {
    final prefs = await SharedPreferences.getInstance();
    List<String> messagesJson =
        _messages.map((msg) => json.encode(msg.toJson())).toList();
    await prefs.setStringList('messages', messagesJson);
  }

  // تحميل الرسائل من SharedPreferences
  Future<void> _loadMessagesFromCache() async {
    final prefs = await SharedPreferences.getInstance();
    List<String>? messagesJson = prefs.getStringList('messages');
    if (messagesJson != null) {
      _messages.addAll(
          messagesJson.map((msg) => ChatMessage.fromJson(json.decode(msg))));
    }
    emit(BotMessageSent(List.from(_messages))); // إرسال الرسائل بعد تحميلها
  }

  void addUserMessage(ChatMessage message) {
    _messages.insert(0, message);
    emit(BotMessageSent(List.from(_messages)));
    _cacheMessages(); // تخزين الرسائل بعد إضافتها
  }

  Future<void> sendMessage(String userText) async {
    final userMessage = ChatMessage(
      user: _user,
      createdAt: DateTime.now(),
      text: userText,
    );

    _messages.insert(0, userMessage);
    emit(BotMessageSent(List.from(_messages)));

    await _cacheMessages(); // تخزين الرسائل بعد إرسالها
    await _getBotResponse();
  }

  Future<void> _getBotResponse() async {
    emit(BotWaitingForResponse(List.from(_messages)));

    try {
      final model = GenerativeModel(model: 'gemini-1.5-pro', apiKey: apikey);
      final content = [Content.text(_chatHistory)];
      final response = await model.generateContent(content);

      if (response != null && response.text != null) {
        final botMessage = ChatMessage(
            user: _bot, createdAt: DateTime.now(), text: response.text!);
        _messages.insert(0, botMessage);
        emit(BotMessageSent(List.from(_messages)));
        await _cacheMessages(); // تخزين الرسائل بعد استلام الرد
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

    await _cacheMessages(); // تخزين الرسائل بعد إرسال الصورة
    await _getBotResponseWithImage(imagePath);
  }

  Future<void> _getBotResponseWithImage(String imagePath) async {
    emit(BotWaitingForResponse(List.from(_messages)));

    try {
      String extractedText = await FlutterTesseractOcr.extractText(imagePath);

      final model = GenerativeModel(model: 'gemini-1.5-pro', apiKey: apikey);
      final content = [Content.text(extractedText)];
      final response = await model.generateContent(content);

      if (response != null && response.text != null) {
        final botMessage = ChatMessage(
            user: _bot, createdAt: DateTime.now(), text: response.text!);
        _messages.insert(0, botMessage);
        emit(BotMessageSent(List.from(_messages)));
        await _cacheMessages(); // تخزين الرسائل بعد استلام الرد
      } else {
        emit(BotError("Error in bot response."));
      }
    } catch (e) {
      emit(BotError("Failed to get response from bot with image."));
    }
  }

  Future<void> clearChatCache(int chatIndex) async {
    final prefs = await SharedPreferences.getInstance();

    // جلب الشاتات القديمة
    List<String>? oldChats = prefs.getStringList('old_chats') ?? [];

    if (chatIndex >= 0 && chatIndex < oldChats.length) {
      // حذف الشات المعين باستخدام الفهرس
      oldChats.removeAt(chatIndex);

      // تحديث قائمة الشاتات
      await prefs.setStringList('old_chats', oldChats);

      // إذا كان الشات الحالي هو الشات الذي يتم حذفه، احذف الرسائل كمان
      if (chatIndex == oldChats.length) {
        await prefs.remove('messages');
        _messages.clear();
      }
    }

    emit(BotMessageSent([])); // تحديث الواجهة بعد الحذف
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
    emit(BotMessageSent([])); // تحديث واجهة الشات
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
    currentChatIndex = index;
    final prefs = await SharedPreferences.getInstance();
    List<String>? oldChats = prefs.getStringList('old_chats') ?? [];

    if (index < oldChats.length) {
      try {
        // فك تشفير JSON
        List<dynamic> decodedChat = json.decode(oldChats[index]);
        List<ChatMessage> oldChat = decodedChat
            .map((msgJson) =>
                ChatMessage.fromJson(msgJson as Map<String, dynamic>))
            .toList();

        _messages.clear();
        _messages.addAll(oldChat);
        emit(BotMessageSent(List.from(_messages))); // تحديث الواجهة
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
        // ignore: unused_local_variable
        String extractedText =
            await FlutterTesseractOcr.extractText(pickedFile.path);
        emit(BotMessageSent([
          ChatMessage(
              user: _user,
              createdAt: DateTime.now(),
              customProperties: {'image': pickedFile.path})
        ]));
        // Add extracted text to chat or proceed with other operations
      } else {
        emit(BotError("No image selected."));
      }
    } else {
      emit(BotError("Permission denied."));
    }
  }
}
