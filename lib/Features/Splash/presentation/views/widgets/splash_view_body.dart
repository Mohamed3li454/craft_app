import 'package:animated_splash_screen/animated_splash_screen.dart';
import 'package:craft_app/Features/home/presentation/views/home_view.dart';
import 'package:flutter/material.dart';
import 'package:lottie/lottie.dart';

class SplashViewBody extends StatelessWidget {
  const SplashViewBody({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Stack(
        children: [
          Container(
            decoration: const BoxDecoration(
              gradient: LinearGradient(
                colors: [Color(0xff0a1833), Color(0xff0c3d97)],
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
              ),
            ),
          ),
          // Animated splash screen without backgroundColor
          Center(
            child: AnimatedSplashScreen(
              splash: Column(
                children: [
                  SizedBox(
                    height: 250,
                    child: Lottie.asset("assets/Animation - 1736005984483.json",
                        fit: BoxFit.fill, repeat: false),
                  ),
                ],
              ),
              nextScreen: const HomeView(),
              duration: 3000,
              splashIconSize: 250,
              centered: true,
              backgroundColor: Colors.transparent, // Ensure transparency
            ),
          ),
        ],
      ),
    );
  }
}
