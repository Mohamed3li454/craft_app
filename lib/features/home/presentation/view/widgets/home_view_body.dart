import 'package:craft_app/constants/app_colors.dart';
import 'package:craft_app/features/home/presentation/view/widgets/custom_animated_button.dart';
import 'package:craft_app/features/home/presentation/view/widgets/custom_text_widget.dart';
import 'package:craft_app/features/home/presentation/view/widgets/suggestion_box.dart';
import 'package:flutter/material.dart';

class HomeViewBody extends StatefulWidget {
  const HomeViewBody({super.key});

  @override
  State<HomeViewBody> createState() => _HomeViewBodyState();
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
    final Size screenSize = MediaQuery.of(context).size;
    final double verticalPadding = screenSize.height * 0.02;
    final double horizontalPadding = screenSize.width * 0.04;

    return Stack(
      children: [
        Container(
          decoration: const BoxDecoration(
            gradient: AppColors.primaryGradient,
          ),
        ),
        LayoutBuilder(
          builder: (context, constraints) {
            return SingleChildScrollView(
              physics: const BouncingScrollPhysics(),
              child: ConstrainedBox(
                constraints: BoxConstraints(
                  minHeight: constraints.maxHeight,
                ),
                child: Padding(
                  padding: EdgeInsets.symmetric(
                    vertical: verticalPadding,
                    horizontal: horizontalPadding,
                  ),
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                    children: [
                      const CustomTextWidget(),
                      CustomAnimatedButton(animation: _animation),
                      _buildSuggestionBoxes(screenSize),
                    ],
                  ),
                ),
              ),
            );
          },
        ),
      ],
    );
  }

  Widget _buildSuggestionBoxes(Size screenSize) {
    return Column(
      children: [
        SizedBox(height: screenSize.height * 0.02),
        const SuggestionBox(
          shadowcolor: AppColors.suggestionGreenShadow,
          header: 'Academic Assistance',
          body: 'Can you help me with my math homework',
          color: AppColors.suggestionGreen,
        ),
        SizedBox(height: screenSize.height * 0.02),
        const SuggestionBox(
          shadowcolor: AppColors.suggestionBlueShadow,
          header: 'Health Improvement Tips',
          body: 'What are some healthy habits I can start with',
          color: AppColors.suggestionBlue,
        ),
        SizedBox(height: screenSize.height * 0.02),
        const SuggestionBox(
          shadowcolor: AppColors.suggestionOrangeShadow,
          header: 'Personal Development',
          body: 'How can I improve my communication skills',
          color: AppColors.suggestionOrange,
        ),
      ],
    );
  }
}
