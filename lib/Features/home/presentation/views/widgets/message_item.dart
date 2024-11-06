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
    return Align(
      alignment: isBot ? Alignment.centerLeft : Alignment.centerRight,
      child: Container(
        margin: const EdgeInsets.symmetric(vertical: 4, horizontal: 16),
        padding:
            const EdgeInsets.only(left: 16, bottom: 16, right: 16, top: 16),
        decoration: BoxDecoration(
          color: isBot ? Colors.blueAccent : Colors.grey.shade200,
          borderRadius: isBot
              ? const BorderRadius.only(
                  topLeft: Radius.circular(16),
                  topRight: Radius.circular(16),
                  bottomRight: Radius.circular(16),
                )
              : const BorderRadius.only(
                  topLeft: Radius.circular(16),
                  topRight: Radius.circular(16),
                  bottomLeft: Radius.circular(16),
                ),
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
      ),
    );
  }
}
