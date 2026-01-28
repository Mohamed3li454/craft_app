import 'package:flutter/material.dart';
import 'package:craft_app/features/home/data/models/chat_message_model.dart';
import 'package:craft_app/features/home/presentation/view/widgets/message_item.dart';

class MessageList extends StatefulWidget {
  final List<ChatMessageModel> messages;

  const MessageList({super.key, required this.messages});

  @override
  State<MessageList> createState() => _MessageListState();
}

class _MessageListState extends State<MessageList> {
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
