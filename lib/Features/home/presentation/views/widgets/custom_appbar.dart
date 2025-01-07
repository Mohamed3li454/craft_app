// ignore_for_file: unused_local_variable, use_build_context_synchronously
import 'package:craft_app/Features/home/presentation/views_model/bot_cubit/bot_cubit.dart';
import 'package:craft_app/Features/home/presentation/views_model/bot_cubit/bot_state.dart';
import 'package:dash_chat_2/dash_chat_2.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:font_awesome_flutter/font_awesome_flutter.dart';
import 'package:lottie/lottie.dart';

class CustomAppBar extends StatefulWidget {
  const CustomAppBar({super.key});

  @override
  State<CustomAppBar> createState() => _CustomAppBarState();
}

class _CustomAppBarState extends State<CustomAppBar> {
  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 18, horizontal: 16),
      decoration: BoxDecoration(
        color: const Color(0xff0c3d97),
        borderRadius: const BorderRadius.vertical(
          bottom: Radius.circular(16),
        ),
        border: Border(
          bottom: BorderSide(
            color: const Color(0xff2f8d79).withValues(alpha: 0.5),
          ),
        ),
      ),
      child: Row(
        children: [
          Container(
            decoration: BoxDecoration(
              color: Colors.black.withValues(alpha: 0.2),
              borderRadius: BorderRadius.circular(8),
            ),
            child: IconButton(
              onPressed: () {
                Navigator.pop(context);
              },
              icon: const Icon(
                Icons.arrow_back_rounded,
                size: 28,
                color: Colors.white,
              ),
            ),
          ),
          const Spacer(),
          Row(
            children: [
              SizedBox(
                  height: 50,
                  width: 50,
                  child: Lottie.asset(
                    "assets/Animation - 1730895861296.json",
                    // fit: BoxFit.fill,
                  )),
              const SizedBox(height: 4),
            ],
          ),
          const Spacer(),
          Container(
            decoration: BoxDecoration(
              color: Colors.black.withValues(alpha: 0.2),
              borderRadius: BorderRadius.circular(8),
            ),
            child: IconButton(
              onPressed: () {
                _showMenuDrawer(context);
              },
              icon: const Icon(
                FontAwesomeIcons.barsStaggered,
                size: 28,
                color: Colors.white,
              ),
            ),
          ),
        ],
      ),
    );
  }

  void _showMenuDrawer(BuildContext context) {
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
                              showDialog(
                                context: context,
                                builder: (BuildContext context) {
                                  return AlertDialog(
                                    backgroundColor: const Color(0xff0b1222),
                                    title: const Text(
                                      "تأكيد الحذف",
                                      style: TextStyle(color: Colors.white),
                                    ),
                                    content: const Text(
                                      "هل أنت متأكد أنك تريد حذف الشات الحالي؟",
                                      style: TextStyle(color: Colors.white70),
                                    ),
                                    actions: [
                                      TextButton(
                                        child: const Text(
                                          "إلغاء",
                                          style: TextStyle(color: Colors.grey),
                                        ),
                                        onPressed: () => Navigator.pop(context),
                                      ),
                                      TextButton(
                                        child: const Text(
                                          "حذف",
                                          style: TextStyle(color: Colors.red),
                                        ),
                                        onPressed: () async {
                                          await botCubit.clearChatCache(
                                              botCubit.currentChatIndex);
                                          Navigator.pop(context);
                                          Navigator.pop(context);
                                        },
                                      ),
                                    ],
                                  );
                                },
                              );
                            } else {
                              ScaffoldMessenger.of(context).showSnackBar(
                                const SnackBar(
                                  content: Text("لا يوجد شات لحذفه حاليًا!"),
                                ),
                              );
                            }
                          },
                          style: ElevatedButton.styleFrom(
                            backgroundColor:
                                const Color(0xffd62828), // اللون الأحمر
                            shape: RoundedRectangleBorder(
                              borderRadius:
                                  BorderRadius.circular(30), // الحواف الدائرية
                            ),
                            padding: const EdgeInsets.symmetric(
                                vertical: 20, horizontal: 30),
                            minimumSize: Size(
                                MediaQuery.of(context).size.width / 2.5,
                                70), // حجم الزر
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
                            backgroundColor:
                                const Color(0xff0c3d97), // اللون الأزرق
                            shape: RoundedRectangleBorder(
                              borderRadius:
                                  BorderRadius.circular(30), // الحواف الدائرية
                            ),
                            padding: const EdgeInsets.symmetric(
                                vertical: 20, horizontal: 30),
                            minimumSize: Size(
                                MediaQuery.of(context).size.width / 2.5,
                                70), // حجم الزر
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
                    color: Color(0xff2f8d79), // لون الفاصل الأخضر
                    thickness: 1,
                    indent: 100,
                    endIndent: 100,
                  ),
                  // قائمة الشاتات القديمة
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
                              final previewText = chat.isNotEmpty
                                  ? chat.last.text
                                  : "Empty Chat";

                              return Card(
                                shadowColor: const Color(0xff2f8d79),
                                elevation: 5,
                                color: const Color(0xff0b1222), // خلفية الشات
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
                                    style:
                                        const TextStyle(color: Colors.white70),
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
}
