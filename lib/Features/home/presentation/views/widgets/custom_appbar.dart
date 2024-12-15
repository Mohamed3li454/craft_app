// ignore_for_file: unused_local_variable, use_build_context_synchronously

import 'package:craft_app/Features/home/presentation/views/widgets/old_chat_view.dart';
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
            color: const Color(0xff2f8d79).withOpacity(0.5),
            width: 3,
          ),
        ),
      ),
      child: Row(
        children: [
          Container(
            decoration: BoxDecoration(
              color: Colors.black.withOpacity(0.2),
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
              color: Colors.black.withOpacity(0.2),
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
      context: context,
      isScrollControlled: true, // يتيح توسعة الـ BottomSheet بالكامل
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (BuildContext context) {
        return DraggableScrollableSheet(
          initialChildSize: 0.5, // النسبة المبدئية لارتفاع الـ BottomSheet
          minChildSize: 0.3, // أقل نسبة ارتفاع
          maxChildSize: 0.9, // أقصى نسبة ارتفاع
          expand: false, // يسمح بالسحب بدلاً من التمدد التلقائي
          builder: (BuildContext context, ScrollController scrollController) {
            return SingleChildScrollView(
              controller: scrollController,
              child: Column(
                children: [
                  // الشريط العلوي
                  Container(
                    width: 50,
                    height: 6,
                    margin: const EdgeInsets.symmetric(vertical: 10),
                    decoration: BoxDecoration(
                      color: Colors.grey[400],
                      borderRadius: BorderRadius.circular(10),
                    ),
                  ),
                  // الأزرار
                  ListTile(
                    leading:
                        const Icon(Icons.delete_forever, color: Colors.red),
                    title: const Text("مسح الشات الحالي"),
                    onTap: () async {
                      final botCubit = context.read<BotCubit>();

                      if (botCubit.messages.isNotEmpty) {
                        showDialog(
                          context: context,
                          builder: (BuildContext context) {
                            return AlertDialog(
                              title: const Text("تأكيد الحذف"),
                              content: const Text(
                                  "هل أنت متأكد أنك تريد حذف الشات الحالي؟"),
                              actions: [
                                TextButton(
                                  child: const Text("إلغاء"),
                                  onPressed: () => Navigator.pop(context),
                                ),
                                TextButton(
                                  child: const Text("حذف",
                                      style: TextStyle(color: Colors.red)),
                                  onPressed: () async {
                                    await botCubit.clearChatCache(
                                        botCubit.currentChatIndex);
                                    Navigator.pop(context);
                                    Navigator.pop(
                                        context); // إغلاق القائمة السفلية
                                  },
                                ),
                              ],
                            );
                          },
                        );
                      } else {
                        ScaffoldMessenger.of(context).showSnackBar(
                          const SnackBar(
                              content: Text("لا يوجد شات لحذفه حاليًا!")),
                        );
                      }
                    },
                  ),
                  ListTile(
                    leading: const Icon(Icons.chat, color: Colors.blue),
                    title: const Text("بدء شات جديد (الاحتفاظ بالقديم)"),
                    onTap: () {
                      context.read<BotCubit>().startNewChat();
                      Navigator.pop(context);
                    },
                  ),
                  const Divider(), // فاصل بين الأزرار وقائمة الشاتات
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
                                child: Text("لا توجد شاتات محفوظة"),
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
                                  ? chat.last.text ?? "No Text"
                                  : "Empty Chat";

                              return ListTile(
                                title: Text("شات ${index + 1}"),
                                subtitle: Text(previewText),
                                trailing: IconButton(
                                  icon: const Icon(Icons.delete,
                                      color: Colors.red),
                                  onPressed: () async {
                                    await botCubit.clearChatCache(index);
                                    setState(() {
                                      oldChats.removeAt(index);
                                    });
                                  },
                                ),
                                onTap: () {
                                  botCubit.loadOldChat(index);
                                  Navigator.pop(
                                      context); // إغلاق الـ BottomSheet
                                },
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
