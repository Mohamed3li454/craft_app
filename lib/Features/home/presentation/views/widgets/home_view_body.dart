import 'package:craft_app/Features/Splash/presentation/views/splash_view.dart';
import 'package:craft_app/Features/home/presentation/views/bot_view.dart';
import 'package:craft_app/Features/home/presentation/views/widgets/suggestion%20_box.dart';
import 'package:craft_app/core/utils/styles.dart';
import 'package:flutter/material.dart';
import 'package:lottie/lottie.dart';
import 'package:get/get.dart';

class HomeViewBody extends StatefulWidget {
  const HomeViewBody({super.key});

  @override
  // ignore: library_private_types_in_public_api
  _HomeViewBodyState createState() => _HomeViewBodyState();
}

class _HomeViewBodyState extends State<HomeViewBody>
    with SingleTickerProviderStateMixin {
  late AnimationController _controller;
  late Animation<double> _animation;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(seconds: 1),
    )..repeat(reverse: true);

    _animation = Tween<double>(begin: 5.0, end: 20.0).animate(_controller);
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Stack(
      children: [
        Container(
          decoration: const BoxDecoration(
            gradient: LinearGradient(
              colors: [Color(0xff0c3d97), Color(0xff0a1833), Color(0xff0b1222)],
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
            ),
          ),
        ),
        Column(
          children: [
            const SizedBox(
              height: 50,
            ),
            const CustomTextWidget(),
            const SizedBox(height: 50),
            AnimatedBuilder(
              animation: _animation,
              builder: (context, child) {
                return Container(
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    boxShadow: [
                      BoxShadow(
                        color: Colors.white.withOpacity(0.8),
                        blurRadius: _animation.value,
                        spreadRadius: _animation.value,
                      ),
                    ],
                  ),
                  child: GestureDetector(
                    onTap: () {
                      Get.to(() => const BotView(),
                          transition: Transition.circularReveal,
                          duration: const Duration(milliseconds: 1500));
                    },
                    child: SizedBox(
                      height: 200,
                      child: Lottie.asset(
                        "assets/Animation - 1729151259606.json",
                        fit: BoxFit.fill,
                      ),
                    ),
                  ),
                );
              },
            ),
            SizedBox(
              height: 50,
            ),
            const SuggestionBox(
              shadowcolor: Color.fromARGB(70, 144, 238, 144),
              header: "Josefin Sans",
              body:
                  "Whereas disregard and contempt for human rights have resulted",
              color: Color(0xffA5D6A7),
            ),
            const SuggestionBox(
              shadowcolor: Color.fromARGB(70, 173, 216, 230),
              header: "Josefin Sans",
              body:
                  "Whereas disregard and contempt for human rights have resulted",
              color: Color.fromARGB(255, 135, 215, 226),
            ),
          ],
        ),
      ],
    );
  }
}

class CustomTextWidget extends StatelessWidget {
  const CustomTextWidget({
    super.key,
  });

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        children: [
          Text(
            "Hello there ",
            style: Styles.textStyle50,
          ),
          ShaderMask(
            shaderCallback: (bounds) => const LinearGradient(
              colors: [
                Color(0xffaef696),
                Color(0xff2f8d79),
              ],
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
            ).createShader(
                Rect.fromLTWH(0.0, 0.0, bounds.width, bounds.height)),
            child: Text(
              "I'm Craft",
              style: Styles.textStyle50,
            ),
          ),
        ],
      ),
    );
  }
}
