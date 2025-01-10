// ignore_for_file: library_private_types_in_public_api

import 'dart:async';
import 'dart:io';

import 'package:dash_chat_2/dash_chat_2.dart';
import 'package:flutter/material.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import 'package:google_fonts/google_fonts.dart';

class MessageItem extends StatefulWidget {
  final ChatMessage message;
  final Set<String> displayedMessageIds;

  const MessageItem({
    super.key,
    required this.message,
    required this.displayedMessageIds,
  });

  @override
  _MessageItemState createState() => _MessageItemState();
}

class _MessageItemState extends State<MessageItem> {
  String displayedText = '';
  int currentIndex = 0;
  Timer? _timer;

  @override
  void initState() {
    super.initState();

    if (widget.message.user.id == "2" &&
        !widget.displayedMessageIds.contains(widget.message.user.id)) {
      widget.displayedMessageIds.add(widget.message.user.id);
      startTypingAnimation();
    } else {
      displayedText = sanitizeText(widget.message.text);
    }
  }

  String sanitizeText(String input) {
    return input.replaceAll(RegExp(r'[^\u0000-\uFFFF]'), '');
  }

  void startTypingAnimation() {
    String cleanText = sanitizeText(widget.message.text);
    _timer = Timer.periodic(const Duration(milliseconds: 2), (timer) {
      if (currentIndex < cleanText.length) {
        setState(() {
          displayedText += cleanText[currentIndex];
          currentIndex++;
        });
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
    bool isBot = widget.message.user.id == "2";
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
        child: widget.message.customProperties != null &&
                widget.message.customProperties!['image'] != null
            ? Container(
                constraints: const BoxConstraints(
                  maxHeight: 250,
                  maxWidth: 250,
                ),
                child: Image.file(
                  File(widget.message.customProperties!['image']),
                  fit: BoxFit.cover,
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
                              fontFamily: "Poppins",
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
