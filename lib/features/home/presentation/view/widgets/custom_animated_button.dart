import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:lottie/lottie.dart';
import 'package:craft_app/core/utils/app_routes.dart';

class CustomAnimatedButton extends StatelessWidget {
  const CustomAnimatedButton({
    super.key,
    required Animation<double> animation,
  }) : _animation = animation;

  final Animation<double> _animation;

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _animation,
      builder: (context, child) {
        return Container(
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            boxShadow: [
              BoxShadow(
                color: Colors.white.withValues(alpha: 0.8),
                blurRadius: _animation.value,
                spreadRadius: _animation.value,
              ),
            ],
          ),
          child: GestureDetector(
            onTap: () {
              context.push(AppRoutes.bot);
            },
            child: SizedBox(
              height: 200,
              child: Lottie.asset(
                'assets/Animation/Animation - 1729151259606.json',
                fit: BoxFit.fill,
              ),
            ),
          ),
        );
      },
    );
  }
}
