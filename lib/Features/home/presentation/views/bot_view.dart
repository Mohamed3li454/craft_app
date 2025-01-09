import 'package:craft_app/Features/home/presentation/views/widgets/bot_view_body.dart';
import 'package:craft_app/Features/home/presentation/views/widgets/custom_dialog.dart';
import 'package:flutter/material.dart';
import 'package:connectivity_plus/connectivity_plus.dart';

class BotView extends StatefulWidget {
  const BotView({super.key, this.suggestiontext = ''});
  final String suggestiontext;

  @override
  State<BotView> createState() => _BotViewState();
}

class _BotViewState extends State<BotView> {
  @override
  void initState() {
    checkConnectivity();
    super.initState();
  }

  void checkConnectivity() async {
    await Connectivity().checkConnectivity();
  }

  @override
  Widget build(BuildContext context) {
    return StreamBuilder(
        stream:
            Connectivity().onConnectivityChanged.map((event) => event.first),
        builder: (context, snapshot) {
          if (snapshot.data == ConnectivityResult.none) {
            return const CustomDialog();
          } else {
            return Scaffold(
                body: BotViewBody(suggestionText: widget.suggestiontext));
          }
        });
  }
}
