// ignore_for_file: public_member_api_docs, sort_constructors_first
import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

class SuggestionBox extends StatelessWidget {
  final String header;
  final String body;
  final Color color;
  final Color shadowcolor;
  const SuggestionBox({
    super.key,
    required this.header,
    required this.body,
    required this.color,
    required this.shadowcolor,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: EdgeInsets.symmetric(vertical: 10, horizontal: 10),
      decoration: BoxDecoration(boxShadow: [
        BoxShadow(color: shadowcolor, blurRadius: 2, offset: Offset(5, 10))
      ], color: color, borderRadius: BorderRadius.all(Radius.circular(15))),
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 15),
      width: double.infinity,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(header,
              style: GoogleFonts.josefinSans(
                  fontSize: 20,
                  fontWeight: FontWeight.bold,
                  color: Colors.white)),
          const SizedBox(
            height: 5,
          ),
          Text(body,
              style: GoogleFonts.lato(fontSize: 18, color: Color(0xff4A4A4A))),
        ],
      ),
    );
  }
}
