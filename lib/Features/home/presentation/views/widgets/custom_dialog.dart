import 'package:flutter/material.dart';
import 'package:lottie/lottie.dart';

class CustomDialog extends StatelessWidget {
  const CustomDialog({super.key});

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      backgroundColor: const Color(0xffE8F6F9),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
      ),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Lottie.asset("assets/Animation - 1736357472964.json",
              fit: BoxFit.fill, repeat: true),
          const SizedBox(height: 20),
          const Text(
            "No Internet Connection",
            style: TextStyle(
              fontSize: 18,
              fontWeight: FontWeight.bold,
              color: Color(0xFF7D5BA6),
            ),
          ),
          const SizedBox(height: 10),
          const Text(
            "Please check your connection and try again.",
            style: TextStyle(
              fontSize: 14,
              color: Color(0xFF4A4A4A),
            ),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 20),
          ElevatedButton(
            onPressed: () {
              Navigator.pop(context);
            },
            style: ElevatedButton.styleFrom(
              backgroundColor: const Color(0xFFFF6F91), // زر بلون وردي
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(12),
              ),
            ),
            child: const Text(
              "OK",
              style: TextStyle(
                color: Colors.white,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
