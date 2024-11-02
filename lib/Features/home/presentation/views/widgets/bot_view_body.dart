import 'package:craft_app/Features/home/presentation/views/widgets/message_input.dart';
import 'package:craft_app/Features/home/presentation/views/widgets/message_list.dart';
import 'package:craft_app/Features/home/presentation/views_model/bot_cubit/bot_state.dart';
import 'package:craft_app/Features/home/presentation/views_model/bot_cubit/bot_cubit.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:lottie/lottie.dart';

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
    _userMessageController.text = widget.suggestionText;
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
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
                return messageList(messages: state.messages);
              } else if (state is BotError) {
                return Center(child: Text(state.message));
              }
              return const Center(child: Text("No messages"));
            },
          ),
        ),
        MessageInput(controller: _userMessageController),
      ],
    );
  }
}
