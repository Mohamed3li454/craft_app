// ignore_for_file: unnecessary_null_comparison

import 'package:craft_app/Features/home/presentation/views_model/bot_cubit/bot_state.dart';
import 'package:craft_app/conests.dart';
import 'package:dash_chat_2/dash_chat_2.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_tesseract_ocr/android_ios.dart';
import 'package:google_generative_ai/google_generative_ai.dart';
import 'package:image_picker/image_picker.dart';
import 'package:permission_handler/permission_handler.dart';

class BotCubit extends Cubit<BotState> {
  BotCubit() : super(BotInitial());

  final _user = ChatUser(id: "1", firstName: "Mohamed");
  final _bot = ChatUser(id: "2", firstName: "Craft");
  final List<ChatMessage> _messages = [];

  String get _chatHistory {
    return _messages.reversed.map((msg) => " ${msg.text}").join("\n");
  }

  void addUserMessage(ChatMessage message) {
    _messages.insert(0, message);
    emit(BotMessageSent(List.from(_messages)));
  }

  Future<void> sendMessage(String userText) async {
    final userMessage = ChatMessage(
      user: _user,
      createdAt: DateTime.now(),
      text: userText,
    );

    _messages.insert(0, userMessage);
    emit(BotMessageSent(List.from(_messages)));

    await _getBotResponse();
  }

  Future<void> _getBotResponse() async {
    emit(BotWaitingForResponse(List.from(_messages)));

    try {
      final model =
          GenerativeModel(model: 'gemini-1.5-pro-001', apiKey: apikey);
      final content = [Content.text(_chatHistory)];
      final response = await model.generateContent(content);

      if (response != null && response.text != null) {
        final botMessage = ChatMessage(
            user: _bot, createdAt: DateTime.now(), text: response.text!);
        _messages.insert(0, botMessage);
        emit(BotMessageSent(List.from(_messages)));
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

    await _getBotResponseWithImage(imagePath);
  }

  Future<void> _getBotResponseWithImage(String imagePath) async {
    emit(BotWaitingForResponse(List.from(_messages)));

    try {
      String extractedText = await FlutterTesseractOcr.extractText(imagePath);

      final model =
          GenerativeModel(model: 'gemini-1.5-pro-001', apiKey: apikey);
      final content = [Content.text(extractedText)];
      final response = await model.generateContent(content);

      if (response != null && response.text != null) {
        final botMessage = ChatMessage(
            user: _bot, createdAt: DateTime.now(), text: response.text!);
        _messages.insert(0, botMessage);
        emit(BotMessageSent(List.from(_messages)));
      } else {
        emit(BotError("Error in bot response."));
      }
    } catch (e) {
      emit(BotError("Failed to get response from bot with image."));
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
