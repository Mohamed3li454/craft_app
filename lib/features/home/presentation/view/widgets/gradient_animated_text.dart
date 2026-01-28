import 'package:animated_text_kit/animated_text_kit.dart';
import 'package:craft_app/constants/app_colors.dart';
import 'package:flutter/material.dart';

class GradientAnimatedText extends StatelessWidget {
  const GradientAnimatedText({super.key});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: ShaderMask(
        shaderCallback: (bounds) => AppColors.accentGradient.createShader(
          Rect.fromLTWH(0.0, 0.0, bounds.width, bounds.height),
        ),
        child: AnimatedTextKit(
          animatedTexts: [
            TypewriterAnimatedText(
              'Hello, How can I assist you?',
              speed: const Duration(milliseconds: 70),
              textStyle: const TextStyle(
                color: Colors.white,
                fontSize: 24,
                fontWeight: FontWeight.bold,
              ),
            ),
          ],
          totalRepeatCount: 100,
        ),
      ),
    );
  }
}
