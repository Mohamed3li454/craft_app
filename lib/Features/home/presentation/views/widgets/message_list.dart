// ignore_for_file: camel_case_types, library_private_types_in_public_api

import 'package:craft_app/Features/home/presentation/views/widgets/message_item.dart';
import 'package:dash_chat_2/dash_chat_2.dart';
import 'package:flutter/material.dart';

class messageList extends StatefulWidget {
  final List<ChatMessage> messages;

  const messageList({super.key, required this.messages});

  @override
  _messageListState createState() => _messageListState();
}

class _messageListState extends State<messageList> {
  final Set<String> displayedMessageIds = {};

  @override
  Widget build(BuildContext context) {
    return ListView.builder(
      reverse: true,
      itemCount: widget.messages.length,
      itemBuilder: (context, index) {
        return MessageItem(
          message: widget.messages[index],
          displayedMessageIds: displayedMessageIds,
        );
      },
    );
  }
}
