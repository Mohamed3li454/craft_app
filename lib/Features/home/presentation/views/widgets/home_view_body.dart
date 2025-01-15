import 'package:craft_app/Features/home/presentation/views/widgets/custom_animated_button.dart';
import 'package:craft_app/Features/home/presentation/views/widgets/custom_text_widget.dart';
import 'package:craft_app/Features/home/presentation/views/widgets/suggestion%20_box.dart';
import 'package:flutter/material.dart';

class HomeViewBody extends StatefulWidget {
  const HomeViewBody({super.key});

  @override
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
    // Get screen size
    final Size screenSize = MediaQuery.of(context).size;
    final double verticalPadding =
        screenSize.height * 0.02; // 2% of screen height
    final double horizontalPadding =
        screenSize.width * 0.04; // 4% of screen width

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
                      CustomAnimatedButton(
                        animation: _animation,
                      ),
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
        SizedBox(height: screenSize.height * 0.02), // Spacing
        SuggestionBox(
          shadowcolor: const Color.fromARGB(70, 144, 238, 144),
          header: "Academic Assistance",
          body: "Can you help me with my math homework",
          color: const Color(0xffA5D6A7),
        ),
        SizedBox(height: screenSize.height * 0.02), // Spacing between boxes
        SuggestionBox(
          shadowcolor: const Color.fromARGB(70, 173, 216, 230),
          header: "Health Improvement Tips",
          body: "What are some healthy habits I can start with",
          color: const Color.fromARGB(255, 135, 215, 226),
        ),
        SizedBox(height: screenSize.height * 0.02), // Spacing between boxes
        SuggestionBox(
          shadowcolor: const Color.fromARGB(70, 240, 190, 150),
          header: "Personal Development",
          body: "How can I improve my communication skills",
          color: const Color.fromARGB(255, 244, 164, 96),
        ),
      ],
    );
  }
}
