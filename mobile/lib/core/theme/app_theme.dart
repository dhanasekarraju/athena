import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

/// ATHENA premium dark theme. Bullish/bearish colors follow trading
/// conventions: emerald for BUY CALL, crimson for BUY PUT, amber for HOLD.
class AppColors {
  static const background = Color(0xFF0A0E14);
  static const surface = Color(0xFF131822);
  static const surfaceElevated = Color(0xFF1B2230);
  static const border = Color(0xFF262E3D);

  static const primary = Color(0xFF5B8DEF);
  static const bullish = Color(0xFF16C784);
  static const bearish = Color(0xFFEA3943);
  static const hold = Color(0xFFF5A623);

  static const textPrimary = Color(0xFFF3F5F9);
  static const textSecondary = Color(0xFF8A93A3);
}

class AppTheme {
  static ThemeData dark() {
    final base = ThemeData.dark(useMaterial3: true);
    final textTheme = GoogleFonts.interTextTheme(base.textTheme).apply(
      bodyColor: AppColors.textPrimary,
      displayColor: AppColors.textPrimary,
    );

    return base.copyWith(
      scaffoldBackgroundColor: AppColors.background,
      textTheme: textTheme,
      colorScheme: const ColorScheme.dark(
        primary: AppColors.primary,
        secondary: AppColors.bullish,
        surface: AppColors.surface,
        error: AppColors.bearish,
      ),
      appBarTheme: const AppBarTheme(
        backgroundColor: AppColors.background,
        elevation: 0,
        centerTitle: false,
        scrolledUnderElevation: 0,
      ),
      cardTheme: CardTheme(
        color: AppColors.surface,
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16),
          side: const BorderSide(color: AppColors.border, width: 1),
        ),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: AppColors.primary,
          foregroundColor: Colors.white,
          padding: const EdgeInsets.symmetric(vertical: 16, horizontal: 24),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
          textStyle: const TextStyle(fontWeight: FontWeight.w600, fontSize: 16),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: AppColors.surfaceElevated,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(14),
          borderSide: BorderSide.none,
        ),
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      ),
      bottomNavigationBarTheme: const BottomNavigationBarThemeData(
        backgroundColor: AppColors.surface,
        selectedItemColor: AppColors.primary,
        unselectedItemColor: AppColors.textSecondary,
        type: BottomNavigationBarType.fixed,
      ),
      dividerTheme: const DividerThemeData(color: AppColors.border, thickness: 1),
    );
  }
}

Color directionColor(String direction) {
  switch (direction) {
    case 'BUY_CALL':
      return AppColors.bullish;
    case 'BUY_PUT':
      return AppColors.bearish;
    default:
      return AppColors.hold;
  }
}

String directionLabel(String direction) {
  switch (direction) {
    case 'BUY_CALL':
      return 'BUY CALL';
    case 'BUY_PUT':
      return 'BUY PUT';
    default:
      return 'HOLD';
  }
}
