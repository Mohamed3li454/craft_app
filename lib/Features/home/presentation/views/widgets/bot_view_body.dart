import 'package:craft_app/Features/home/presentation/views/widgets/custom_appbar.dart';
import 'package:craft_app/Features/home/presentation/views/widgets/custom_dialog.dart';
import 'package:craft_app/Features/home/presentation/views/widgets/gradient_animated_text.dart';
import 'package:craft_app/Features/home/presentation/views/widgets/message_input.dart';
import 'package:craft_app/Features/home/presentation/views/widgets/message_list.dart';
import 'package:craft_app/Features/home/presentation/views_model/bot_cubit/bot_state.dart';
import 'package:craft_app/Features/home/presentation/views_model/bot_cubit/bot_cubit.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:lottie/lottie.dart';
import 'package:connectivity_plus/connectivity_plus.dart';

class BotViewBody extends StatefulWidget {
  const BotViewBody({super.key, required this.suggestionText});
  final String suggestionText;

  @override
  State<BotViewBody> createState() => _BotViewBodyState();
}

class _BotViewBodyState extends State<BotViewBody> {
  final TextEditingController _userMessageController = TextEditingController();

  @override
  void initState() {
    super.initState();
    checkConnectivity();
    _userMessageController.text = widget.suggestionText;
  }

  void checkConnectivity() async {
    await Connectivity().checkConnectivity();
  }

  @override
  Widget build(BuildContext context) {
    return StreamBuilder(
      stream: Connectivity().onConnectivityChanged.map((event) => event.first),
      builder: (context, snapshot) {
        return Stack(
          children: [
            Container(
              decoration: const BoxDecoration(
                gradient: LinearGradient(
                  colors: [
                    Color(0xff0c3d97),
                    Color(0xff0c3d97),
                    Color(0xff0a1833),
                    Color(0xff0b1222)
                  ],
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                ),
              ),
            ),
            Column(
              children: [
                const Padding(
                  padding: EdgeInsets.only(top: 35),
                  child: CustomAppBar(),
                ),
                Expanded(
                  child: BlocBuilder<BotCubit, BotState>(
                    builder: (context, state) {
                      if (state is BotWaitingForResponse) {
                        return Stack(
                          children: [
                            messageList(messages: state.messages),
                            Center(
                                child: Lottie.asset(
                                    "assets/Animation - 1729151439930.json")),
                          ],
                        );
                      } else if (state is BotMessageSent) {
                        if (state.messages.isEmpty) {
                          if (snapshot.data == ConnectivityResult.none) {
                            return const CustomDialog();
                          } else {
                            return const GradientAnimatedText();
                          }
                        } else {
                          return messageList(messages: state.messages);
                        }
                      } else if (state is BotError) {
                        return Center(child: Text(state.message));
                      } else {
                        return const GradientAnimatedText();
                      }
                    },
                  ),
                ),
                MessageInput(controller: _userMessageController),
              ],
            )
          ],
        );
      },
    );
  }
}
