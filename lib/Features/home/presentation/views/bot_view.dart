import 'package:craft_app/Features/home/presentation/views/widgets/bot_view_body.dart';
import 'package:flutter/material.dart';

class BotView extends StatelessWidget {
  const BotView({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(),
      body: const BotViewBody(),
    );
  }
}