// menu_drawer.dart
// ignore_for_file: use_build_context_synchronously

import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:awesome_dialog/awesome_dialog.dart';
import 'package:alert_info/alert_info.dart';
import 'package:dash_chat_2/dash_chat_2.dart';
import 'package:lottie/lottie.dart';
import 'package:craft_app/Features/home/presentation/views_model/bot_cubit/bot_cubit.dart';
import 'package:craft_app/Features/home/presentation/views_model/bot_cubit/bot_state.dart';

void showMenuDrawer(BuildContext context) {
  showModalBottomSheet(
    backgroundColor: const Color(0xff0a1833),
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
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16.0),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      ElevatedButton(
                        onPressed: () async {
                          final botCubit = context.read<BotCubit>();

                          if (botCubit.messages.isNotEmpty) {
                            AwesomeDialog(
                              context: context,
                              dialogType: DialogType.error,
                              animType: AnimType.bottomSlide,
                              title: 'Warning: Clear Chat History',
                              titleTextStyle: const TextStyle(
                                fontSize: 22,
                                fontWeight: FontWeight.bold,
                                color: Color(0xffe94560),
                              ),
                              desc:
                                  'This action will permanently delete all messages. You cannot undo this action.',
                              descTextStyle: const TextStyle(
                                fontSize: 16,
                                color: Color(0xfff5f7fa),
                              ),
                              dialogBackgroundColor: const Color(0xff1a1a2e),
                              btnCancel: ElevatedButton(
                                style: ElevatedButton.styleFrom(
                                  backgroundColor: const Color(0xff0f3460),
                                  shape: RoundedRectangleBorder(
                                    borderRadius: BorderRadius.circular(12),
                                  ),
                                ),
                                onPressed: () {
                                  Navigator.pop(context);
                                },
                                child: const Text(
                                  'Cancel',
                                  style: TextStyle(
                                    color: Colors.white,
                                    fontWeight: FontWeight.bold,
                                  ),
                                ),
                              ),
                              btnOk: ElevatedButton(
                                style: ElevatedButton.styleFrom(
                                  backgroundColor: Colors.red,
                                  shape: RoundedRectangleBorder(
                                    borderRadius: BorderRadius.circular(12),
                                  ),
                                ),
                                onPressed: () async {
                                  await botCubit.clearChatCache(
                                      botCubit.currentChatIndex);
                                  Navigator.pop(context);
                                },
                                child: const Text(
                                  'Confirm',
                                  style: TextStyle(
                                    color: Colors.white,
                                    fontWeight: FontWeight.bold,
                                  ),
                                ),
                              ),
                            ).show();
                          } else {
                            AlertInfo.show(
                              typeInfo: TypeInfo.warning,
                              context: context,
                              text: 'No chat messages to delete!',
                            );
                          }
                        },
                        style: ElevatedButton.styleFrom(
                          backgroundColor: const Color(0xffd62828),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(30),
                          ),
                          padding: const EdgeInsets.symmetric(
                              vertical: 20, horizontal: 30),
                          minimumSize:
                              Size(MediaQuery.of(context).size.width / 2.5, 70),
                        ),
                        child: const Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Icon(Icons.delete, size: 24, color: Colors.white),
                            SizedBox(height: 8),
                            Text(
                              "Delete",
                              style: TextStyle(
                                fontSize: 16,
                                fontWeight: FontWeight.bold,
                                color: Colors.white,
                              ),
                            ),
                          ],
                        ),
                      ),
                      ElevatedButton(
                        onPressed: () {
                          context.read<BotCubit>().startNewChat();
                          Navigator.pop(context);
                        },
                        style: ElevatedButton.styleFrom(
                          backgroundColor: const Color(0xff0c3d97),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(30),
                          ),
                          padding: const EdgeInsets.symmetric(
                              vertical: 20, horizontal: 30),
                          minimumSize:
                              Size(MediaQuery.of(context).size.width / 2.5, 70),
                        ),
                        child: const Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Icon(Icons.chat, size: 24, color: Colors.white),
                            SizedBox(height: 8),
                            Text(
                              "New Chat",
                              style: TextStyle(
                                fontSize: 16,
                                fontWeight: FontWeight.bold,
                                color: Colors.white,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
                const Divider(
                  color: Color(0xff2f8d79),
                  thickness: 1,
                  indent: 100,
                  endIndent: 100,
                ),
                BlocBuilder<BotCubit, BotState>(
                  builder: (context, state) {
                    final botCubit = context.read<BotCubit>();
                    return FutureBuilder<List<List<ChatMessage>>>(
                      future: botCubit.getOldChats(),
                      builder: (context, snapshot) {
                        if (!snapshot.hasData) {
                          return const Center(
                            child: CircularProgressIndicator(),
                          );
                        }

                        final oldChats = snapshot.data!;
                        if (oldChats.isEmpty) {
                          return const Padding(
                            padding: EdgeInsets.all(16.0),
                            child: Center(
                              child: Text(
                                "There's no chats to show",
                                style: TextStyle(color: Colors.white70),
                              ),
                            ),
                          );
                        }

                        return ListView.builder(
                          shrinkWrap: true,
                          physics: const NeverScrollableScrollPhysics(),
                          itemCount: oldChats.length,
                          itemBuilder: (context, index) {
                            final chat = oldChats[index];
                            final previewText =
                                chat.isNotEmpty ? chat.last.text : "Empty Chat";

                            return Card(
                              shadowColor: const Color(0xff2f8d79),
                              elevation: 5,
                              color: const Color(0xff0b1222),
                              child: ListTile(
                                leading: Lottie.asset(
                                  "assets/Animation - 1729151259606.json",
                                  fit: BoxFit.fill,
                                ),
                                title: Text(
                                  "Chat ${index + 1}",
                                  style: const TextStyle(color: Colors.white),
                                ),
                                subtitle: Text(
                                  previewText,
                                  style: const TextStyle(color: Colors.white70),
                                ),
                                onTap: () {
                                  botCubit.loadOldChat(index);
                                  Navigator.pop(context);
                                },
                              ),
                            );
                          },
                        );
                      },
                    );
                  },
                ),
              ],
            ),
          );
        },
      );
    },
  );
}
