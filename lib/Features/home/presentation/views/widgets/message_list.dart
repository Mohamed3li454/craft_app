import 'package:craft_app/Features/home/presentation/views/widgets/message_item.dart';
import 'package:dash_chat_2/dash_chat_2.dart';
import 'package:flutter/material.dart';

// ignore: camel_case_types
class messageList extends StatelessWidget {
  final List<ChatMessage> messages;

  const messageList({super.key, required this.messages});

  @override
  Widget build(BuildContext context) {
    return ListView.builder(
      reverse: true,
      itemCount: messages.length,
      itemBuilder: (context, index) {
        return MessageItem(message: messages[index]);
      },
    );
  }
}
