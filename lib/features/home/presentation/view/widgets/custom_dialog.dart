import 'package:craft_app/constants/app_colors.dart';
import 'package:craft_app/features/home/presentation/view/widgets/custom_appbar.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:lottie/lottie.dart';

class CustomDialog extends StatelessWidget {
  const CustomDialog({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Stack(
        children: [
          Container(
            decoration: const BoxDecoration(
              gradient: AppColors.extendedGradient,
            ),
          ),
          Column(
            children: [
              const Padding(
                padding: EdgeInsets.only(top: 35),
                child: CustomAppBar(),
              ),
              const SizedBox(height: 100),
              AlertDialog(
                backgroundColor: AppColors.dialogLightBackground,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(16),
                ),
                content: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Lottie.asset(
                      'assets/Animation/Animation - 1736357472964.json',
                      fit: BoxFit.fill,
                      repeat: true,
                    ),
                    const SizedBox(height: 20),
                    const Text(
                      'No Internet Connection',
                      style: TextStyle(
                        fontSize: 18,
                        fontWeight: FontWeight.bold,
                        color: AppColors.dialogPurple,
                      ),
                    ),
                    const SizedBox(height: 10),
                    const Text(
                      'Please check your connection and try again.',
                      style: TextStyle(
                        fontSize: 14,
                        color: AppColors.dialogDarkText,
                      ),
                      textAlign: TextAlign.center,
                    ),
                    const SizedBox(height: 20),
                    ElevatedButton(
                      onPressed: () {
                        if (context.canPop()) {
                          context.pop();
                        }
                      },
                      style: ElevatedButton.styleFrom(
                        backgroundColor: AppColors.dialogPink,
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(12),
                        ),
                      ),
                      child: const Text(
                        'OK',
                        style: TextStyle(
                          color: Colors.white,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
