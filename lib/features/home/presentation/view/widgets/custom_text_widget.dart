import 'package:craft_app/constants/app_colors.dart';
import 'package:craft_app/core/utils/styles.dart';
import 'package:flutter/material.dart';

class CustomTextWidget extends StatelessWidget {
  const CustomTextWidget({super.key});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        children: [
          Text(
            'Hello there ',
            style: Styles.textStyle50,
          ),
          ShaderMask(
            shaderCallback: (bounds) => AppColors.accentGradient.createShader(
              Rect.fromLTWH(0.0, 0.0, bounds.width, bounds.height),
            ),
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
