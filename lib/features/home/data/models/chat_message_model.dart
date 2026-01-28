import 'package:dash_chat_2/dash_chat_2.dart';
import 'package:equatable/equatable.dart';

/// Data model representing a chat message.
/// Extends Equatable with defensive JSON parsing, toJson, and copyWith.
class ChatMessageModel extends Equatable {
  final String userId;
  final String userName;
  final String text;
  final DateTime createdAt;
  final String? imagePath;

  const ChatMessageModel({
    required this.userId,
    required this.userName,
    required this.text,
    required this.createdAt,
    this.imagePath,
  });

  bool get isBot => userId == '2';

  factory ChatMessageModel.fromJson(Map<String, dynamic> json) {
    String parsedUserId = '1';
    String parsedUserName = 'Mohamed';

    if (json['userId'] != null) {
      parsedUserId = json['userId'].toString();
    } else if (json['user'] is Map) {
      parsedUserId = (json['user']['id'] ?? '1').toString();
    }

    if (json['userName'] != null) {
      parsedUserName = json['userName'].toString();
    } else if (json['user'] is Map) {
      parsedUserName = (json['user']['firstName'] ?? 'Mohamed').toString();
    }

    DateTime parsedDate;
    if (json['createdAt'] is int) {
      parsedDate = DateTime.fromMillisecondsSinceEpoch(json['createdAt'] as int);
    } else if (json['createdAt'] != null) {
      parsedDate = DateTime.tryParse(json['createdAt'].toString()) ?? DateTime.now();
    } else {
      parsedDate = DateTime.now();
    }

    String? parsedImagePath = json['imagePath'] as String?;
    if (parsedImagePath == null && json['customProperties'] is Map) {
      parsedImagePath = json['customProperties']['image'] as String?;
    }

    return ChatMessageModel(
      userId: parsedUserId,
      userName: parsedUserName,
      text: json['text']?.toString() ?? '',
      createdAt: parsedDate,
      imagePath: parsedImagePath,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'userId': userId,
      'userName': userName,
      'text': text,
      'createdAt': createdAt.millisecondsSinceEpoch,
      'imagePath': imagePath,
      // Retain DashChat JSON shape for backward compatibility
      'user': {
        'id': userId,
        'firstName': userName,
      },
      if (imagePath != null) 'customProperties': {'image': imagePath},
    };
  }

  ChatMessage toChatMessage() {
    return ChatMessage(
      user: ChatUser(id: userId, firstName: userName),
      createdAt: createdAt,
      text: text,
      customProperties: imagePath != null ? {'image': imagePath} : null,
    );
  }

  factory ChatMessageModel.fromChatMessage(ChatMessage message) {
    return ChatMessageModel(
      userId: message.user.id,
      userName: message.user.firstName ?? '',
      text: message.text,
      createdAt: message.createdAt,
      imagePath: message.customProperties?['image'] as String?,
    );
  }

  ChatMessageModel copyWith({
    String? userId,
    String? userName,
    String? text,
    DateTime? createdAt,
    String? imagePath,
  }) {
    return ChatMessageModel(
      userId: userId ?? this.userId,
      userName: userName ?? this.userName,
      text: text ?? this.text,
      createdAt: createdAt ?? this.createdAt,
      imagePath: imagePath ?? this.imagePath,
    );
  }

  @override
  List<Object?> get props => [userId, userName, text, createdAt, imagePath];
}
