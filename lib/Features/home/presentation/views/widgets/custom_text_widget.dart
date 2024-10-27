import 'package:craft_app/core/utils/styles.dart';
import 'package:flutter/material.dart';

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
