import 'dart:convert';
import 'package:craft_app/features/home/data/models/chat_message_model.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Local storage service managing chat caching using SharedPreferences.
class ChatLocalService {
  static const String _currentChatKey = 'current_chat_messages';
  static const String _oldChatsKey = 'old_chats';

  Future<void> cacheMessages(List<ChatMessageModel> messages) async {
    final prefs = await SharedPreferences.getInstance();
    final jsonList = messages.map((m) => jsonEncode(m.toJson())).toList();
    await prefs.setStringList(_currentChatKey, jsonList);
  }

  Future<List<ChatMessageModel>> loadCachedMessages() async {
    final prefs = await SharedPreferences.getInstance();
    final jsonList = prefs.getStringList(_currentChatKey);
    if (jsonList == null || jsonList.isEmpty) return [];

    return jsonList.map((str) {
      final decoded = jsonDecode(str) as Map<String, dynamic>;
      return ChatMessageModel.fromJson(decoded);
    }).toList();
  }

  Future<List<List<ChatMessageModel>>> getOldChats() async {
    final prefs = await SharedPreferences.getInstance();
    final rawList = prefs.getStringList(_oldChatsKey) ?? [];

    return rawList.map((chatJson) {
      final List<dynamic> list = jsonDecode(chatJson) as List<dynamic>;
      return list
          .map((item) => ChatMessageModel.fromJson(item as Map<String, dynamic>))
          .toList();
    }).toList();
  }

  Future<void> saveOldChats(List<List<ChatMessageModel>> chats) async {
    final prefs = await SharedPreferences.getInstance();
    final rawList = chats.map((chat) {
      final jsonList = chat.map((msg) => msg.toJson()).toList();
      return jsonEncode(jsonList);
    }).toList();
    await prefs.setStringList(_oldChatsKey, rawList);
  }

  Future<void> clearCurrentChat() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_currentChatKey);
  }
}
