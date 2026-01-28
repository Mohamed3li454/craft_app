import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_markdown_plus/flutter_markdown_plus.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:craft_app/features/home/data/models/chat_message_model.dart';

class MessageItem extends StatefulWidget {
  final ChatMessageModel message;
  final Set<String> displayedMessageIds;

  const MessageItem({
    super.key,
    required this.message,
    required this.displayedMessageIds,
  });

  @override
  State<MessageItem> createState() => _MessageItemState();
}

class _MessageItemState extends State<MessageItem> {
  String displayedText = '';
  int currentIndex = 0;
  Timer? _timer;

  @override
  void initState() {
    super.initState();

    final messageId =
        '${widget.message.userId}_${widget.message.createdAt.millisecondsSinceEpoch}';
    if (widget.message.isBot && !widget.displayedMessageIds.contains(messageId)) {
      widget.displayedMessageIds.add(messageId);
      startTypingAnimation();
    } else {
      displayedText = sanitizeText(widget.message.text);
    }
  }

  String sanitizeText(String input) {
    return input.replaceAll(RegExp(r'[^\u0000-\uFFFF]'), '');
  }

  void startTypingAnimation() {
    final cleanText = sanitizeText(widget.message.text);
    _timer = Timer.periodic(const Duration(milliseconds: 2), (timer) {
      if (currentIndex < cleanText.length) {
        if (mounted) {
          setState(() {
            displayedText += cleanText[currentIndex];
            currentIndex++;
          });
        }
      } else {
        timer.cancel();
      }
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final bool isBot = widget.message.isBot;
    return Align(
      alignment: isBot ? Alignment.centerLeft : Alignment.centerRight,
      child: Container(
        margin: const EdgeInsets.symmetric(vertical: 4, horizontal: 16),
        padding: const EdgeInsets.all(16),
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
        child: widget.message.imagePath != null
            ? Container(
                constraints: const BoxConstraints(
                  maxHeight: 250,
                  maxWidth: 250,
                ),
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(8),
                  child: Image.file(
                    File(widget.message.imagePath!),
                    fit: BoxFit.cover,
                  ),
                ),
              )
            : isBot
                ? MarkdownBody(
                    data: sanitizeText(displayedText),
                    selectable: true,
                    styleSheet: MarkdownStyleSheet.fromTheme(
                      Theme.of(context).copyWith(
                        textTheme: Theme.of(context).textTheme.apply(
                              fontSizeFactor: 1.2,
                              fontFamily: 'Poppins',
                              bodyColor: Colors.white,
                            ),
                      ),
                    ),
                  )
                : Text(
                    sanitizeText(widget.message.text),
                    style: GoogleFonts.openSans(
                      fontSize: 16,
                      color: Colors.black,
                    ),
                  ),
      ),
    );
  }
}
