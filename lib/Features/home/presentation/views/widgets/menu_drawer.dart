// menu_drawer.dart
// ignore_for_file: use_build_context_synchronously

import 'package:craft_app/Features/home/presentation/views/bot_view.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:awesome_dialog/awesome_dialog.dart';
import 'package:alert_info/alert_info.dart';
import 'package:dash_chat_2/dash_chat_2.dart';
import 'package:get/get.dart';
import 'package:lottie/lottie.dart';
import 'package:craft_app/Features/home/presentation/views_model/bot_cubit/bot_cubit.dart';
import 'package:craft_app/Features/home/presentation/views_model/bot_cubit/bot_state.dart';

// Constants for reusable values
const _backgroundColor = Color(0xff0a1833);
const _cardColor = Color(0xff0b1222);
const _dividerColor = Color(0xff2f8d79);
const _deleteButtonColor = Color(0xffd62828);
const _newChatButtonColor = Color(0xff0c3d97);
const _dialogBackgroundColor = Color(0xff1a1a2e);
const _warningTextColor = Color(0xffe94560);
const _textColor = Color(0xfff5f7fa);

// Reusable button styles
final _buttonShape = RoundedRectangleBorder(
  borderRadius: BorderRadius.circular(30),
);

final _dialogButtonShape = RoundedRectangleBorder(
  borderRadius: BorderRadius.circular(12),
);

// Reusable text styles
const _buttonTextStyle = TextStyle(
  fontSize: 16,
  fontWeight: FontWeight.bold,
  color: Colors.white,
);

const _chatTitleStyle = TextStyle(color: Colors.white);
const _chatSubtitleStyle = TextStyle(color: Colors.white70);

// Cached Lottie animation
final _cachedLottieAnimation = Lottie.asset(
  "assets/Animation/Animation - 1729151259606.json",
  fit: BoxFit.fill,
);

void showMenuDrawer(BuildContext context) {
  showModalBottomSheet(
    backgroundColor: _backgroundColor,
    context: context,
    isScrollControlled: true,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
    ),
    builder: (BuildContext context) {
      return DraggableScrollableSheet(
        initialChildSize: 0.5,
        minChildSize: 0.3,
        maxChildSize: 0.9,
        expand: false,
        builder: (BuildContext context, ScrollController scrollController) {
          return SingleChildScrollView(
            controller: scrollController,
            child: Column(
              children: [
                Container(
                  width: 50,
                  height: 6,
                  margin: const EdgeInsets.symmetric(vertical: 10),
                  decoration: BoxDecoration(
                    color: Colors.grey[400],
                    borderRadius: BorderRadius.circular(10),
                  ),
                ),
                _buildButtonRow(context),
                const Divider(
                  color: _dividerColor,
                  thickness: 1,
                  indent: 100,
                  endIndent: 100,
                ),
                _buildChatList(context),
              ],
            ),
          );
        },
      );
    },
  );
}

Widget _buildButtonRow(BuildContext context) {
  return Padding(
    padding: const EdgeInsets.symmetric(horizontal: 16.0),
    child: Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        _buildDeleteButton(context),
        _buildNewChatButton(context),
      ],
    ),
  );
}

Widget _buildDeleteButton(BuildContext context) {
  return ElevatedButton(
    onPressed: () async {
      final botCubit = context.read<BotCubit>();
      if (botCubit.messages.isNotEmpty) {
        _showDeleteConfirmationDialog(context, botCubit);
      } else {
        AlertInfo.show(
          typeInfo: TypeInfo.warning,
          context: context,
          text: 'No chat messages to delete!',
        );
      }
    },
    style: ElevatedButton.styleFrom(
      backgroundColor: _deleteButtonColor,
      shape: _buttonShape,
      padding: const EdgeInsets.symmetric(vertical: 20, horizontal: 30),
      minimumSize: Size(MediaQuery.of(context).size.width / 2.5, 70),
    ),
    child: const Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(Icons.delete, size: 24, color: Colors.white),
        SizedBox(height: 8),
        Text("Delete", style: _buttonTextStyle),
      ],
    ),
  );
}

Widget _buildNewChatButton(BuildContext context) {
  return ElevatedButton(
    onPressed: () {
      context.read<BotCubit>().startNewChat();
      Navigator.pop(context);
    },
    style: ElevatedButton.styleFrom(
      backgroundColor: _newChatButtonColor,
      shape: _buttonShape,
      padding: const EdgeInsets.symmetric(vertical: 20, horizontal: 30),
      minimumSize: Size(MediaQuery.of(context).size.width / 2.5, 70),
    ),
    child: const Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(Icons.chat, size: 24, color: Colors.white),
        SizedBox(height: 8),
        Text("New Chat", style: _buttonTextStyle),
      ],
    ),
  );
}

void _showDeleteConfirmationDialog(BuildContext context, BotCubit botCubit) {
  AwesomeDialog(
    context: context,
    dialogType: DialogType.error,
    animType: AnimType.bottomSlide,
    title: 'Warning: Clear Chat History',
    titleTextStyle: const TextStyle(
      fontSize: 22,
      fontWeight: FontWeight.bold,
      color: _warningTextColor,
    ),
    desc:
        'This action will permanently delete all messages. You cannot undo this action.',
    descTextStyle: const TextStyle(
      fontSize: 16,
      color: _textColor,
    ),
    dialogBackgroundColor: _dialogBackgroundColor,
    btnCancel: ElevatedButton(
      style: ElevatedButton.styleFrom(
        backgroundColor: const Color(0xff0f3460),
        shape: _dialogButtonShape,
      ),
      onPressed: () => Navigator.pop(context),
      child: const Text('Cancel', style: _buttonTextStyle),
    ),
    btnOk: ElevatedButton(
      style: ElevatedButton.styleFrom(
        backgroundColor: Colors.red,
        shape: _dialogButtonShape,
      ),
      onPressed: () async {
        await botCubit.clearChatCache(botCubit.currentChatIndex);
        Navigator.pop(context);
        Navigator.pop(context);
      },
      child: const Text('Confirm', style: _buttonTextStyle),
    ),
  ).show();
}

Widget _buildChatList(BuildContext context) {
  return BlocBuilder<BotCubit, BotState>(
    builder: (context, state) {
      final botCubit = context.read<BotCubit>();
      return FutureBuilder<List<List<ChatMessage>>>(
        future: botCubit.getOldChats(),
        builder: (context, snapshot) {
          if (!snapshot.hasData) {
            return const Center(child: CircularProgressIndicator());
          }

          final oldChats = snapshot.data!;
          if (oldChats.isEmpty) {
            return const Padding(
              padding: EdgeInsets.all(16.0),
              child: Center(
                child: Text(
                  "There's no chats to show",
                  style: _chatSubtitleStyle,
                ),
              ),
            );
          }

          return ListView.separated(
            key: const PageStorageKey<String>('chat_list'),
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            itemCount: oldChats.length,
            separatorBuilder: (context, index) => const SizedBox(height: 4),
            itemBuilder: (context, index) {
              final chat = oldChats[index];
              final previewText =
                  chat.isNotEmpty ? chat.last.text : "Empty Chat";

              return Card(
                shadowColor: _dividerColor,
                elevation: 5,
                color: _cardColor,
                child: ListTile(
                  leading: _cachedLottieAnimation,
                  title: Text("Chat ${index + 1}", style: _chatTitleStyle),
                  subtitle: Text(previewText, style: _chatSubtitleStyle),
                  onTap: () async {
                    Navigator.pop(context);
                    Navigator.pop(context);
                    await botCubit.loadOldChat(index);
                    Get.to(() => const BotView());
                  },
                ),
              );
            },
          );
        },
      );
    },
  );
}
