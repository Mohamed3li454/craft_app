import 'package:craft_app/Features/home/presentation/views_model/bot_cubit/bot_cubit.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:image_picker/image_picker.dart';

class MessageInput extends StatelessWidget {
  final TextEditingController controller;

  const MessageInput({super.key, required this.controller});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(8.0),
      child: Row(
        children: [
          IconButton(
            icon: const Icon(Icons.image),
            onPressed: () async {
              final pickedFile =
                  await ImagePicker().pickImage(source: ImageSource.gallery);
              if (pickedFile != null) {
                // ignore: use_build_context_synchronously
                context.read<BotCubit>().sendImage(pickedFile.path);
              }
            },
          ),
          Expanded(
            child: TextField(
              controller: controller,
              decoration: const InputDecoration(
                hintText: "Type your message...",
                border: OutlineInputBorder(),
              ),
            ),
          ),
          IconButton(
            icon: const Icon(Icons.send),
            onPressed: () {
              final text = controller.text;
              if (text.isNotEmpty) {
                context.read<BotCubit>().sendMessage(text);
                controller.clear();
              }
            },
          ),
        ],
      ),
    );
  }
}
