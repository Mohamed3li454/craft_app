import 'package:craft_app/Features/Splash/presentation/views/splash_view.dart';
import 'package:craft_app/Features/home/presentation/views_model/bot_cubit/bot_cubit.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_dotenv/flutter_dotenv.dart';
import 'package:get/get_navigation/src/root/get_material_app.dart';

Future main() async {
  await dotenv.load(fileName: "assets/.env");
  runApp(const MyApp());
}

class MyApp extends StatelessWidget {
  const MyApp({super.key});

  // This widget is the root of your application.
  @override
  Widget build(BuildContext context) {
    return MultiBlocProvider(
      providers: [
        BlocProvider(
          create: (context) => BotCubit(),
        ),
        BlocProvider(
          create: (context) => ImagePickerCubit(),
        )
      ],
      child: GetMaterialApp(
        darkTheme: ThemeData.dark(),
        debugShowCheckedModeBanner: false,
        home: const SplashView(),
      ),
    );
  }
}
