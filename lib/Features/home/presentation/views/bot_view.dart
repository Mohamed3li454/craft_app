import 'package:craft_app/Features/home/presentation/views/widgets/bot_view_body.dart';
import 'package:flutter/material.dart';

class BotView extends StatelessWidget {
  const BotView({super.key, this.suggestiontext = ''});
  final String suggestiontext;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(),
      body: BotViewBody(
        suggestionText: suggestiontext,
      ),
    );
  }
}
