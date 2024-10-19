import 'dart:io';
import 'package:craft_app/conests.dart';
import 'package:dash_chat_2/dash_chat_2.dart';
import 'package:flutter/material.dart';
import 'package:google_generative_ai/google_generative_ai.dart';
import 'package:image_picker/image_picker.dart';
import 'package:lottie/lottie.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:flutter_tesseract_ocr/flutter_tesseract_ocr.dart';

class BotView extends StatefulWidget {
  const BotView({super.key});

  @override
  State<BotView> createState() => _BotViewState();
}

class _BotViewState extends State<BotView> with SingleTickerProviderStateMixin {
  final TextEditingController _usermessage = TextEditingController();
  final _user = ChatUser(id: "1", firstName: "Mohamed");
  final _bot = ChatUser(id: "2", firstName: "bot");
  List<ChatMessage> messages = [];
  final GlobalKey<AnimatedListState> _listKey = GlobalKey<AnimatedListState>();

  late AnimationController _controller;
  late Animation<double> _animation;

  bool isWaitingForResponse = false; // حالة انتظار رد البوت

  final ImagePicker _picker = ImagePicker(); // لإختيار الصور

  @override
  void initState() {
    super.initState();

    // إعداد AnimationController لمدة 1 ثانية
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(seconds: 1),
    );

    // إعداد الأنيميشن ليكون نوعه Fade-In
    _animation = CurvedAnimation(
      parent: _controller,
      curve: Curves.easeIn,
    );
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Expanded(
          child: Stack(
            children: [
              AnimatedList(
                key: _listKey,
                reverse: true, // لعرض الرسائل من الأسفل إلى الأعلى
                initialItemCount: messages.length,
                itemBuilder: (context, index, animation) {
                  final message = messages[index];
                  // إذا كانت الرسالة من البوت، نضيف FadeTransition
                  if (message.user.id == _bot.id) {
                    return FadeTransition(
                      opacity: animation,
                      child: _buildMessageItem(message),
                    );
                  }
                  // رسائل المستخدم العادية
                  return _buildMessageItem(message);
                },
              ),
              // عرض Lottie animation إذا كان في انتظار لرد البوت
              if (isWaitingForResponse)
                Center(
                  child: Lottie.asset(
                    "assets/Animation - 1729151439930.json",
                    fit: BoxFit.fill,
                  ),
                ),
            ],
          ),
        ),
        _buildMessageInput(),
      ],
    );
  }

  // دالة لبناء واجهة الرسالة سواء للمستخدم أو البوت
  Widget _buildMessageItem(ChatMessage message) {
    bool isBot = message.user.id == _bot.id;
    return Container(
      margin: EdgeInsets.symmetric(vertical: 4, horizontal: 16),
      padding: EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: isBot ? Colors.blueAccent : Colors.grey.shade200,
        borderRadius: BorderRadius.circular(12),
      ),
      child: message.customProperties != null &&
              message.customProperties!['image'] != null
          ? Image.file(
              File(message.customProperties!['image']), // عرض الصورة
              height: 150,
              width: 150,
            )
          : Text(
              message.text,
              style: TextStyle(
                color: isBot ? Colors.white : Colors.black,
              ),
            ),
    );
  }

  // واجهة إدخال الرسالة من المستخدم
  Widget _buildMessageInput() {
    return Padding(
      padding: const EdgeInsets.all(8.0),
      child: Row(
        children: [
          IconButton(
            icon: Icon(Icons.image),
            onPressed: _pickImage, // استدعاء الدالة لاختيار الصورة
          ),
          Expanded(
            child: TextField(
              controller: _usermessage,
              decoration: InputDecoration(
                hintText: "Type your message...",
                border: OutlineInputBorder(),
              ),
            ),
          ),
          IconButton(
            icon: Icon(Icons.send),
            onPressed: () {
              final text = _usermessage.text;
              if (text.isNotEmpty) {
                final message = ChatMessage(
                  user: _user,
                  createdAt: DateTime.now(),
                  text: text,
                );
                onsend(message);
                _usermessage.clear();
              }
            },
          ),
        ],
      ),
    );
  }

  // دالة لاختيار الصورة من الهاتف

  Future<void> _pickImage() async {
    final statuses = await [
      Permission.camera,
    ].request();

    if (statuses[Permission.camera]!.isGranted) {
      final pickedFile = await _picker.pickImage(source: ImageSource.gallery);
      setState(() {
        if (pickedFile != null) {
          final message = ChatMessage(
            user: _user,
            createdAt: DateTime.now(),
            customProperties: {'image': pickedFile.path},
          );
          onsendImage(message);
        }
      });
    } else {
      print("Permission denied");
    }
  }

  Future<void> onsend(ChatMessage message) async {
    // إضافة رسالة المستخدم فورًا إلى الشات
    setState(() {
      messages.insert(0, message);
      _listKey.currentState!.insertItem(0);
      isWaitingForResponse = true; // عرض Lottie عند انتظار الرد
    });

    // تجميع جميع الرسائل السابقة في الشات كـ نص واحد
    String chatHistory = '';
    for (var msg in messages.reversed) {
      chatHistory += "${msg.user.firstName}: ${msg.text}\n";
    }

    // استدعاء نموذج الذكاء الاصطناعي وإرسال السياق الكامل
    final model =
        GenerativeModel(model: 'gemini-1.5-flash-latest', apiKey: apikey);
    final content = [Content.text(chatHistory)];
    final response = await model.generateContent(content);

    // بعد الحصول على استجابة البوت، أضف رسالة البوت مع الأنيميشن
    if (response != null && response.text != null) {
      _controller.forward(from: 0); // تشغيل الأنيميشن

      setState(() {
        final botMessage = ChatMessage(
          user: _bot,
          createdAt: DateTime.now(),
          text: response.text!,
        );
        messages.insert(0, botMessage);
        _listKey.currentState!.insertItem(0); // إضافة الرسالة مع الأنيميشن
        isWaitingForResponse = false; // إخفاء Lottie بعد وصول الرد
      });
    }
  }

  // دالة لإرسال الصور

  Future<void> onsendImage(ChatMessage message) async {
    setState(() {
      messages.insert(0, message);
      _listKey.currentState!.insertItem(0);
      isWaitingForResponse = true; // عرض Lottie عند انتظار الرد
    });

    // استخدم Tesseract لتحليل الصورة
    String extractedText = await FlutterTesseractOcr.extractText(
        message.customProperties!['image']);

    // استدعاء نموذج الذكاء الاصطناعي بعد استخراج النص
    final model =
        GenerativeModel(model: 'gemini-1.5-flash-latest', apiKey: apikey);
    final content = [Content.text(extractedText)];
    final response = await model.generateContent(content);

    // بعد الحصول على استجابة البوت
    if (response != null && response.text != null) {
      _controller.forward(from: 0); // تشغيل الأنيميشن

      setState(() {
        final botMessage = ChatMessage(
          user: _bot,
          createdAt: DateTime.now(),
          text: response.text!,
        );
        messages.insert(0, botMessage);
        _listKey.currentState!.insertItem(0); // إضافة الرسالة مع الأنيميشن
        isWaitingForResponse = false; // إخفاء Lottie بعد وصول الرد
      });
    }
  }
}
