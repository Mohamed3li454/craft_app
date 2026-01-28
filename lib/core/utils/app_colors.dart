import 'package:flutter/material.dart';

/// Centralized color constants for the Craft App.
/// Use these instead of hardcoded color values throughout the app.
abstract class AppColors {
  // Primary gradient colors
  static const Color primaryBlue = Color(0xff0c3d97);
  static const Color darkNavy = Color(0xff0a1833);
  static const Color deepDark = Color(0xff0b1222);

  // Accent colors
  static const Color accentGreen = Color(0xff2f8d79);
  static const Color lightGreen = Color(0xffaef696);

  // UI colors
  static const Color cardBackground = Color(0xFF1E1E2C);
  static const Color dialogBackground = Color(0xff1a1a2e);
  static const Color warningRed = Color(0xffe94560);
  static const Color deleteRed = Color(0xffd62828);

  // Text colors
  static const Color textPrimary = Color(0xfff5f7fa);
  static const Color textSecondary = Colors.white70;

  // Suggestion box colors
  static const Color suggestionGreen = Color(0xffA5D6A7);
  static const Color suggestionBlue = Color(0xff87D7E2);
  static const Color suggestionOrange = Color(0xffF4A460);

  // Primary gradient (3 colors)
  static const LinearGradient primaryGradient = LinearGradient(
    colors: [primaryBlue, darkNavy, deepDark],
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
  );

  // Extended gradient (4 colors, for bot view)
  static const LinearGradient extendedGradient = LinearGradient(
    colors: [primaryBlue, primaryBlue, darkNavy, deepDark],
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
  );

  // Accent gradient (for text effects)
  static const LinearGradient accentGradient = LinearGradient(
    colors: [lightGreen, accentGreen],
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
  );
}
