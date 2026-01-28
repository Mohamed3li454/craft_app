import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:craft_app/features/home/presentation/manager/bot_cubit/bot_cubit.dart';
import 'package:craft_app/features/home/presentation/view/widgets/bot_view_body.dart';
import 'package:craft_app/features/home/presentation/view/widgets/custom_dialog.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

class BotView extends StatelessWidget {
  final String suggestiontext;

  const BotView({super.key, this.suggestiontext = ''});

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (context) => BotCubit(),
      child: StreamBuilder<List<ConnectivityResult>>(
        stream: Connectivity().onConnectivityChanged,
        builder: (context, snapshot) {
          final isOffline = snapshot.hasData &&
              snapshot.data!.isNotEmpty &&
              snapshot.data!.first == ConnectivityResult.none;

          if (isOffline) {
            return const CustomDialog();
          }

          return Scaffold(
            body: BotViewBody(suggestionText: suggestiontext),
          );
        },
      ),
    );
  }
}
