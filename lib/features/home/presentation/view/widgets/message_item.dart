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

  bool _isArabicOrRtl(String text) {
    final arabicRegex = RegExp(r'[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]');
    return arabicRegex.hasMatch(text);
  }

  @override
  Widget build(BuildContext context) {
    final bool isBot = widget.message.isBot;
    final String contentToRender = isBot ? displayedText : widget.message.text;
    final bool isRtl = _isArabicOrRtl(contentToRender);

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
            : Directionality(
                textDirection: isRtl ? TextDirection.rtl : TextDirection.ltr,
                child: isBot
                    ? MarkdownBody(
                        data: sanitizeText(displayedText),
                        selectable: true,
                        styleSheet: MarkdownStyleSheet.fromTheme(
                          Theme.of(context).copyWith(
                            textTheme: Theme.of(context).textTheme.apply(
                                  fontSizeFactor: 1.1,
                                  fontFamily: isRtl
                                      ? GoogleFonts.cairo().fontFamily
                                      : 'Poppins',
                                  bodyColor: Colors.white,
                                ),
                          ),
                        ).copyWith(
                          p: isRtl
                              ? GoogleFonts.cairo(
                                  fontSize: 15,
                                  height: 1.6,
                                  color: Colors.white,
                                )
                              : GoogleFonts.poppins(
                                  fontSize: 15,
                                  height: 1.5,
                                  color: Colors.white,
                                ),
                          listBullet: isRtl
                              ? GoogleFonts.cairo(
                                  fontSize: 15,
                                  color: Colors.white,
                                )
                              : GoogleFonts.poppins(
                                  fontSize: 15,
                                  color: Colors.white,
                                ),
                          strong: isRtl
                              ? GoogleFonts.cairo(
                                  fontWeight: FontWeight.bold,
                                  color: Colors.white,
                                )
                              : null,
                          pPadding: const EdgeInsets.only(bottom: 6),
                        ),
                      )
                    : Text(
                        sanitizeText(widget.message.text),
                        style: isRtl
                            ? GoogleFonts.cairo(
                                fontSize: 16,
                                color: Colors.black,
                              )
                            : GoogleFonts.openSans(
                                fontSize: 16,
                                color: Colors.black,
                              ),
                      ),
              ),
      ),
    );
  }
}
