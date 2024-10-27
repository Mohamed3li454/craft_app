import 'package:craft_app/Features/home/presentation/views/widgets/custom_animated_button.dart';
import 'package:craft_app/Features/home/presentation/views/widgets/custom_text_widget.dart';
import 'package:craft_app/Features/home/presentation/views/widgets/suggestion%20_box.dart';
import 'package:flutter/material.dart';

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
            CustomAnimatedButton(
              animation: _animation,
            ),
            const SizedBox(
              height: 50,
            ),
            const SuggestionBox(
              shadowcolor: Color.fromARGB(70, 144, 238, 144),
              header: "Academic Assistance",
              body: "Can you help me with my math homework",
              color: Color(0xffA5D6A7),
            ),
            const SuggestionBox(
              shadowcolor: Color.fromARGB(70, 173, 216, 230),
              header: "Health Improvement Tips",
              body: "What are some healthy habits I can start with",
              color: Color.fromARGB(255, 135, 215, 226),
            ),
            const SuggestionBox(
              shadowcolor: Color.fromARGB(70, 240, 190, 150),
              header: "Personal Development",
              body: "How can I improve my communication skills",
              color: Color.fromARGB(255, 244, 164, 96),
            ),
          ],
        ),
      ],
    );
  }
}
