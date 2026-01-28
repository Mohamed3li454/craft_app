import 'package:flutter/material.dart';
import 'package:craft_app/constants/app_colors.dart';

/// App-wide theme definitions and BuildContext extension.
abstract class AppTheme {
  AppTheme._();

  static ThemeData get darkTheme => ThemeData(
        useMaterial3: true,
        brightness: Brightness.dark,
        fontFamily: 'Poppins',
        colorScheme: const ColorScheme.dark(
          primary: AppColors.primaryBlue,
          secondary: AppColors.accentGreen,
          surface: AppColors.deepDark,
        ),
        scaffoldBackgroundColor: AppColors.deepDark,
      );
}

extension ThemeHelper on BuildContext {
  ColorScheme get colors => Theme.of(this).colorScheme;
  bool get isDark => Theme.of(this).brightness == Brightness.dark;
  Color get titleColor => colors.onSurface;
  Color get mutedColor => isDark ? AppColors.darkMuted : AppColors.muted;
}
