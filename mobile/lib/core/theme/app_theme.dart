import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

/// Classical Athena — warm paper, deep ink, restrained trade colors.
/// Brand uses a display serif; numbers/UI use a humanist sans (not Inter).
class AppColors {
  static const background = Color(0xFFF3EDE3);
  static const surface = Color(0xFFFAF6EF);
  static const surfaceElevated = Color(0xFFFFFFFF);
  static const border = Color(0xFFD6CBB8);

  static const ink = Color(0xFF1C1915);
  static const paper = Color(0xFFF3EDE3);
  static const primary = Color(0xFF1C1915);
  static const accent = Color(0xFF6B5A3E);

  static const bullish = Color(0xFF1F6B4A);
  static const bearish = Color(0xFF9B2C2C);
  static const hold = Color(0xFF8A6A2F);

  static const textPrimary = Color(0xFF1C1915);
  static const textSecondary = Color(0xFF6B6458);
}

class AppTypography {
  static const displayFamily = 'Fraunces';
  static const bodyFamily = 'Source Sans 3';
}

class AppTheme {
  static ThemeData light() {
    final display = GoogleFonts.frauncesTextTheme();
    final body = GoogleFonts.sourceSans3TextTheme();
    final textTheme = body.copyWith(
      displayLarge: display.displayLarge?.copyWith(color: AppColors.textPrimary, fontWeight: FontWeight.w600),
      displayMedium: display.displayMedium?.copyWith(color: AppColors.textPrimary, fontWeight: FontWeight.w600),
      displaySmall: display.displaySmall?.copyWith(color: AppColors.textPrimary, fontWeight: FontWeight.w600),
      headlineLarge: display.headlineLarge?.copyWith(color: AppColors.textPrimary, fontWeight: FontWeight.w600),
      headlineMedium: display.headlineMedium?.copyWith(color: AppColors.textPrimary, fontWeight: FontWeight.w600),
      headlineSmall: display.headlineSmall?.copyWith(color: AppColors.textPrimary, fontWeight: FontWeight.w600),
      titleLarge: display.titleLarge?.copyWith(color: AppColors.textPrimary, fontWeight: FontWeight.w600),
      titleMedium: body.titleMedium?.copyWith(color: AppColors.textPrimary, fontWeight: FontWeight.w600),
      titleSmall: body.titleSmall?.copyWith(color: AppColors.textPrimary, fontWeight: FontWeight.w600),
      bodyLarge: body.bodyLarge?.copyWith(color: AppColors.textPrimary, height: 1.45),
      bodyMedium: body.bodyMedium?.copyWith(color: AppColors.textPrimary, height: 1.45),
      bodySmall: body.bodySmall?.copyWith(color: AppColors.textSecondary, height: 1.4),
      labelLarge: body.labelLarge?.copyWith(color: AppColors.textPrimary, fontWeight: FontWeight.w600),
    );

    final base = ThemeData(
      useMaterial3: true,
      brightness: Brightness.light,
      scaffoldBackgroundColor: AppColors.background,
      textTheme: textTheme,
      colorScheme: const ColorScheme.light(
        primary: AppColors.ink,
        onPrimary: AppColors.paper,
        secondary: AppColors.accent,
        surface: AppColors.surface,
        error: AppColors.bearish,
        onSurface: AppColors.textPrimary,
      ),
    );

    return base.copyWith(
      appBarTheme: AppBarTheme(
        backgroundColor: AppColors.background,
        foregroundColor: AppColors.ink,
        elevation: 0,
        centerTitle: false,
        scrolledUnderElevation: 0,
        titleTextStyle: display.titleLarge?.copyWith(
          color: AppColors.ink,
          fontWeight: FontWeight.w600,
          fontSize: 22,
        ),
      ),
      cardTheme: CardTheme(
        color: AppColors.surface,
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(4),
          side: const BorderSide(color: AppColors.border, width: 1),
        ),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: AppColors.ink,
          foregroundColor: AppColors.paper,
          padding: const EdgeInsets.symmetric(vertical: 16, horizontal: 24),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(4)),
          textStyle: const TextStyle(fontWeight: FontWeight.w600, fontSize: 16),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: AppColors.surfaceElevated,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(4),
          borderSide: const BorderSide(color: AppColors.border),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(4),
          borderSide: const BorderSide(color: AppColors.border),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(4),
          borderSide: const BorderSide(color: AppColors.ink, width: 1.5),
        ),
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      ),
      bottomNavigationBarTheme: const BottomNavigationBarThemeData(
        backgroundColor: AppColors.surface,
        selectedItemColor: AppColors.ink,
        unselectedItemColor: AppColors.textSecondary,
        type: BottomNavigationBarType.fixed,
        elevation: 0,
      ),
      dividerTheme: const DividerThemeData(color: AppColors.border, thickness: 1),
      chipTheme: ChipThemeData(
        backgroundColor: AppColors.surface,
        selectedColor: AppColors.ink,
        labelStyle: textTheme.labelLarge!,
        secondaryLabelStyle: textTheme.labelLarge!.copyWith(color: AppColors.paper),
        side: const BorderSide(color: AppColors.border),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(4)),
      ),
    );
  }

  /// Kept for older call sites; classical Athena is light.
  static ThemeData dark() => light();
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
