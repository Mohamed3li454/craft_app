// ignore_for_file: file_names

import 'package:craft_app/Features/home/presentation/views/bot_view.dart';
import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:google_fonts/google_fonts.dart';

class SuggestionBox extends StatelessWidget {
  final String header;
  final String body;
  final Color color;
  final Color shadowcolor;
  final void Function()? ontap;
  const SuggestionBox({
    super.key,
    required this.header,
    required this.body,
    required this.color,
    required this.shadowcolor,
    this.ontap,
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: () {
        Get.to(() => BotView(suggestiontext: body));
      },
      child: Container(
        margin: const EdgeInsets.symmetric(vertical: 10, horizontal: 10),
        decoration: BoxDecoration(
            boxShadow: [
              BoxShadow(
                  color: shadowcolor,
                  blurRadius: 2,
                  offset: const Offset(5, 10))
            ],
            color: color,
            borderRadius: const BorderRadius.all(Radius.circular(15))),
        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 15),
        width: double.infinity,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(header,
                style: GoogleFonts.josefinSans(
                    fontSize: 25,
                    fontWeight: FontWeight.bold,
                    color: Colors.white)),
            const SizedBox(
              height: 5,
            ),
            Text(body,
                style: GoogleFonts.lato(
                    fontSize: 20, color: const Color(0xff4A4A4A))),
          ],
        ),
      ),
    );
  }
}
