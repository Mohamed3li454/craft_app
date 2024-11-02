import 'dart:io';

import 'package:dash_chat_2/dash_chat_2.dart';
import 'package:flutter/material.dart';
import 'package:flutter_markdown/flutter_markdown.dart';

class MessageItem extends StatelessWidget {
  final ChatMessage message;

  const MessageItem({super.key, required this.message});

  @override
  Widget build(BuildContext context) {
    bool isBot = message.user.id == "2";
    return Container(
      margin: const EdgeInsets.symmetric(vertical: 4, horizontal: 16),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: isBot ? Colors.blueAccent : Colors.grey.shade200,
        borderRadius: BorderRadius.circular(12),
      ),
      child: message.customProperties != null &&
              message.customProperties!['image'] != null
          ? Image.file(
              File(message.customProperties!['image']),
              height: 150,
              width: 150,
            )
          : isBot
              ? MarkdownBody(
                  data: message.text,
                  selectable: true,
                  styleSheet: MarkdownStyleSheet.fromTheme(
                    Theme.of(context).copyWith(
                      textTheme: Theme.of(context).textTheme.apply(
                            bodyColor: Colors.white,
                          ),
                    ),
                  ),
                )
              : Text(
                  message.text,
                  style: const TextStyle(color: Colors.black),
                ),
    );
  }
}
