import 'package:flutter/material.dart';

/// Centralized color constants for Craft App.
/// Following the architecture blueprint: Zero hardcoded hex colors or inline styles in view widgets.
abstract class AppColors {
  AppColors._();

  // Primary palette & backgrounds
  static const Color primaryBlue = Color(0xff0c3d97);
  static const Color darkNavy = Color(0xff0a1833);
  static const Color deepDark = Color(0xff0b1222);

  // Accent colors
  static const Color accentGreen = Color(0xff2f8d79);
  static const Color lightGreen = Color(0xffaef696);

  // UI & Card colors
  static const Color cardBackground = Color(0xFF1E1E2C);
  static const Color dialogBackground = Color(0xff1a1a2e);
  static const Color dialogButtonBlue = Color(0xff0f3460);
  static const Color dialogLightBackground = Color(0xffe8f6f9);
  static const Color dialogPurple = Color(0xff7d5ba6);
  static const Color dialogDarkText = Color(0xff4a4a4a);
  static const Color dialogPink = Color(0xffff6f91);

  // Semantic & alert colors
  static const Color warningRed = Color(0xffe94560);
  static const Color deleteRed = Color(0xffd62828);
  static const Color actionBlue = Colors.blue;

  // Text colors
  static const Color textPrimary = Color(0xfff5f7fa);
  static const Color textSecondary = Colors.white70;
  static const Color textMuted = Colors.grey;
  static const Color darkMuted = Color(0xFF9E9E9E);
  static const Color muted = Color(0xFF757575);

  // Suggestion box colors & shadows
  static const Color suggestionGreen = Color(0xffa5d6a7);
  static const Color suggestionBlue = Color(0xff87d7e2);
  static const Color suggestionOrange = Color(0xfff4a460);
  static const Color suggestionGreenShadow = Color.fromARGB(70, 144, 238, 144);
  static const Color suggestionBlueShadow = Color.fromARGB(70, 173, 216, 230);
  static const Color suggestionOrangeShadow = Color.fromARGB(70, 240, 190, 150);

  // Primary background gradient (3 stops)
  static const LinearGradient primaryGradient = LinearGradient(
    colors: [primaryBlue, darkNavy, deepDark],
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
  );

  // Extended gradient (4 stops, for BotView)
  static const LinearGradient extendedGradient = LinearGradient(
    colors: [primaryBlue, primaryBlue, darkNavy, deepDark],
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
  );

  // Splash gradient (2 stops)
  static const LinearGradient splashGradient = LinearGradient(
    colors: [darkNavy, primaryBlue],
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
