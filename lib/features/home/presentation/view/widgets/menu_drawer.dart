import 'package:alert_info/alert_info.dart';
import 'package:awesome_dialog/awesome_dialog.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:lottie/lottie.dart';
import 'package:craft_app/constants/app_colors.dart';
import 'package:craft_app/features/home/data/models/chat_message_model.dart';
import 'package:craft_app/features/home/presentation/manager/bot_cubit/bot_cubit.dart';

final _buttonShape = RoundedRectangleBorder(
  borderRadius: BorderRadius.circular(30),
);

final _dialogButtonShape = RoundedRectangleBorder(
  borderRadius: BorderRadius.circular(12),
);

const _buttonTextStyle = TextStyle(
  fontSize: 16,
  fontWeight: FontWeight.bold,
  color: Colors.white,
);

const _chatTitleStyle = TextStyle(color: Colors.white);
const _chatSubtitleStyle = TextStyle(color: Colors.white70);

void showMenuDrawer(BuildContext context) {
  showModalBottomSheet(
    backgroundColor: AppColors.darkNavy,
    context: context,
    isScrollControlled: true,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
    ),
    builder: (BuildContext bottomSheetContext) {
      return BlocProvider.value(
        value: context.read<BotCubit>(),
        child: DraggableScrollableSheet(
          initialChildSize: 0.5,
          minChildSize: 0.3,
          maxChildSize: 0.9,
          expand: false,
          builder: (BuildContext ctx, ScrollController scrollController) {
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
                  _buildButtonRow(ctx),
                  const Divider(
                    color: AppColors.accentGreen,
                    thickness: 1,
                    indent: 100,
                    endIndent: 100,
                  ),
                  _buildChatList(ctx),
                ],
              ),
            );
          },
        ),
      );
    },
  );
}

Widget _buildButtonRow(BuildContext context) {
  return Padding(
    padding: const EdgeInsets.symmetric(horizontal: 16.0),
    child: LayoutBuilder(
      builder: (context, constraints) {
        return Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            _buildDeleteButton(context, constraints.maxWidth),
            _buildNewChatButton(context, constraints.maxWidth),
          ],
        );
      },
    ),
  );
}

Widget _buildDeleteButton(BuildContext context, double maxWidth) {
  return ElevatedButton(
    onPressed: () {
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
      backgroundColor: AppColors.deleteRed,
      shape: _buttonShape,
      padding: const EdgeInsets.symmetric(vertical: 20, horizontal: 30),
      minimumSize: Size(maxWidth / 2.5, 70),
    ),
    child: const Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(Icons.delete, size: 24, color: Colors.white),
        SizedBox(height: 8),
        Text('Delete', style: _buttonTextStyle),
      ],
    ),
  );
}

Widget _buildNewChatButton(BuildContext context, double maxWidth) {
  return ElevatedButton(
    onPressed: () {
      context.read<BotCubit>().startNewChat();
      Navigator.pop(context);
    },
    style: ElevatedButton.styleFrom(
      backgroundColor: AppColors.primaryBlue,
      shape: _buttonShape,
      padding: const EdgeInsets.symmetric(vertical: 20, horizontal: 30),
      minimumSize: Size(maxWidth / 2.5, 70),
    ),
    child: const Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(Icons.chat, size: 24, color: Colors.white),
        SizedBox(height: 8),
        Text('New Chat', style: _buttonTextStyle),
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
      color: AppColors.warningRed,
    ),
    desc:
        'This action will permanently delete all messages. You cannot undo this action.',
    descTextStyle: const TextStyle(
      fontSize: 16,
      color: AppColors.textPrimary,
    ),
    dialogBackgroundColor: AppColors.dialogBackground,
    btnCancel: ElevatedButton(
      style: ElevatedButton.styleFrom(
        backgroundColor: AppColors.dialogButtonBlue,
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
        if (context.mounted) {
          Navigator.pop(context);
        }
      },
      child: const Text('Confirm', style: _buttonTextStyle),
    ),
  ).show();
}

Widget _buildChatList(BuildContext context) {
  final botCubit = context.read<BotCubit>();
  return FutureBuilder<List<List<ChatMessageModel>>>(
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
              chat.isNotEmpty ? chat.last.text : 'Empty Chat';

          return Card(
            shadowColor: AppColors.accentGreen,
            elevation: 5,
            color: AppColors.deepDark,
            child: ListTile(
              leading: SizedBox(
                width: 40,
                height: 40,
                child: Lottie.asset(
                  'assets/Animation/Animation - 1729151259606.json',
                  fit: BoxFit.fill,
                ),
              ),
              title: Text('Chat ${index + 1}', style: _chatTitleStyle),
              subtitle: Text(previewText, style: _chatSubtitleStyle),
              onTap: () async {
                Navigator.pop(context);
                await botCubit.loadOldChat(index);
              },
            ),
          );
        },
      );
    },
  );
}
