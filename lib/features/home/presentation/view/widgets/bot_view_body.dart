import 'package:craft_app/constants/app_colors.dart';
import 'package:craft_app/core/widgets/custom_error_widget.dart';
import 'package:craft_app/features/home/presentation/manager/bot_cubit/bot_cubit.dart';
import 'package:craft_app/features/home/presentation/view/widgets/custom_appbar.dart';
import 'package:craft_app/features/home/presentation/view/widgets/gradient_animated_text.dart';
import 'package:craft_app/features/home/presentation/view/widgets/message_input.dart';
import 'package:craft_app/features/home/presentation/view/widgets/message_list.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:lottie/lottie.dart';

class BotViewBody extends StatefulWidget {
  final String suggestionText;

  const BotViewBody({super.key, required this.suggestionText});

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
  void dispose() {
    _userMessageController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Stack(
      children: [
        Container(
          decoration: const BoxDecoration(
            gradient: AppColors.extendedGradient,
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
                  Widget content;

                  if (state is BotWaitingForResponse) {
                    content = Stack(
                      children: [
                        if (state.messages.isNotEmpty)
                          MessageList(messages: state.messages),
                        Center(
                          child: Lottie.asset(
                            'assets/Animation/Animation - 1729151439930.json',
                          ),
                        ),
                      ],
                    );
                  } else if (state is BotMessageSent) {
                    if (state.messages.isEmpty) {
                      content = const GradientAnimatedText();
                    } else {
                      content = MessageList(messages: state.messages);
                    }
                  } else if (state is BotFailure) {
                    content = CustomErrorWidget(
                      errMessage: state.errMessage,
                      onRetry: () =>
                          context.read<BotCubit>().loadCachedMessages(),
                    );
                  } else {
                    content = const GradientAnimatedText();
                  }

                  return AnimatedSwitcher(
                    duration: const Duration(milliseconds: 280),
                    child: KeyedSubtree(
                      key: ValueKey(state.runtimeType),
                      child: content,
                    ),
                  );
                },
              ),
            ),
            MessageInput(controller: _userMessageController),
          ],
        ),
      ],
    );
  }
}
