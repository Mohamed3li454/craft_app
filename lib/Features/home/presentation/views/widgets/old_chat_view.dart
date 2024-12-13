import 'package:craft_app/Features/home/presentation/views_model/bot_cubit/bot_cubit.dart';
import 'package:dash_chat_2/dash_chat_2.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

class OldChatsScreen extends StatefulWidget {
  @override
  _OldChatsScreenState createState() => _OldChatsScreenState();
}

class _OldChatsScreenState extends State<OldChatsScreen> {
  List<List<ChatMessage>> _oldChats = [];

  @override
  void initState() {
    super.initState();
    _loadOldChats();
  }

  Future<void> _loadOldChats() async {
    final chats = await context.read<BotCubit>().getOldChats();
    setState(() {
      _oldChats = chats;
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text("Old Chats"),
      ),
      body: _oldChats.isEmpty
          ? Center(child: Text("No old chats found"))
          : ListView.builder(
              itemCount: _oldChats.length,
              itemBuilder: (context, index) {
                final chat = _oldChats[index];
                final previewText = chat.isNotEmpty
                    ? chat.last.text ?? "No Text"
                    : "Empty Chat";

                return ListTile(
                  title: Text("Chat ${index + 1}"),
                  subtitle: Text(previewText),
                  trailing: IconButton(
                    icon: Icon(Icons.delete, color: Colors.red),
                    onPressed: () async {
                      await context.read<BotCubit>().clearChatCache(index);
                      setState(() {
                        _oldChats.removeAt(index); // تحديث الواجهة
                      });
                    },
                  ),
                  onTap: () {
                    context.read<BotCubit>().loadOldChat(index);
                    Navigator.pop(context); // الرجوع لشاشة الدردشة
                  },
                );
              },
            ),
    );
  }
}
