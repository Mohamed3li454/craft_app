// custom_app_bar.dart
import 'package:flutter/material.dart';
import 'package:font_awesome_flutter/font_awesome_flutter.dart';
import 'package:lottie/lottie.dart';
import 'menu_drawer.dart'; // سيتم استيراد ملف menu_drawer.dart

class CustomAppBar extends StatefulWidget {
  const CustomAppBar({super.key});

  @override
  State<CustomAppBar> createState() => _CustomAppBarState();
}

class _CustomAppBarState extends State<CustomAppBar> {
  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 18, horizontal: 16),
      decoration: BoxDecoration(
        color: const Color(0xff0c3d97),
        borderRadius: const BorderRadius.vertical(
          bottom: Radius.circular(16),
        ),
        border: Border(
          bottom: BorderSide(
            color: const Color(0xff2f8d79).withValues(alpha: 0.5),
          ),
        ),
      ),
      child: Row(
        children: [
          Container(
            decoration: BoxDecoration(
              color: Colors.black.withValues(alpha: 0.2),
              borderRadius: BorderRadius.circular(8),
            ),
            child: IconButton(
              onPressed: () {
                Navigator.pop(context);
              },
              icon: const Icon(
                Icons.arrow_back_rounded,
                size: 28,
                color: Colors.white,
              ),
            ),
          ),
          const Spacer(),
          Row(
            children: [
              SizedBox(
                  height: 50,
                  width: 50,
                  child: Lottie.asset(
                    "assets/Animation - 1730895861296.json",
                    // fit: BoxFit.fill,
                  )),
              const SizedBox(height: 4),
            ],
          ),
          const Spacer(),
          Container(
            decoration: BoxDecoration(
              color: Colors.black.withValues(alpha: 0.2),
              borderRadius: BorderRadius.circular(8),
            ),
            child: IconButton(
              onPressed: () {
                showMenuDrawer(context); // استدعاء الدالة من menu_drawer.dart
              },
              icon: const Icon(
                FontAwesomeIcons.barsStaggered,
                size: 28,
                color: Colors.white,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
