import 'package:craft_app/Features/home/presentation/views/widgets/old_chat_view.dart';
import 'package:craft_app/Features/home/presentation/views_model/bot_cubit/bot_cubit.dart';
import 'package:dash_chat_2/dash_chat_2.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:font_awesome_flutter/font_awesome_flutter.dart';
import 'package:lottie/lottie.dart';

class CustomAppBar extends StatelessWidget {
  const CustomAppBar({super.key});

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
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (BuildContext context) {
        return Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.delete_forever, color: Colors.red),
              title: const Text("مسح الشات الحالي"),
              onTap: () async {
                final botCubit = context.read<BotCubit>();
                final currentChatIndex = botCubit.currentChatIndex;

                if (currentChatIndex != null) {
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
                              await botCubit.clearChatCache(currentChatIndex);
                              Navigator.pop(context); // إغلاق نافذة التأكيد
                              Navigator.pop(context); // إغلاق القائمة
                            },
                          ),
                        ],
                      );
                    },
                  );
                } else {
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(content: Text("لا يوجد شات لحذفه حاليًا!")),
                  );
                }
              },
            ),
            ListTile(
              leading: const Icon(Icons.chat, color: Colors.blue),
              title: const Text("بدء شات جديد (الاحتفاظ بالقديم)"),
              onTap: () {
                context.read<BotCubit>().startNewChat();
                Navigator.pop(context); // إغلاق القائمة
              },
            ),
            IconButton(
              onPressed: () async {
                List<List<ChatMessage>> oldChats =
                    await context.read<BotCubit>().getOldChats();

                // هنا يمكن فتح شاشة جديدة لاستعراض الشاتات القديمة
                Navigator.push(
                  context,
                  MaterialPageRoute(
                    builder: (context) => OldChatsScreen(),
                  ),
                );
              },
              icon: Icon(Icons.history),
            ),
          ],
        );
      },
    );
  }
}
