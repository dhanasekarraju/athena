import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

/// Classical Athena palettes — light (paper/ink) and dark (ink/paper).
/// Call [AppColors.bind] from MaterialApp.builder when brightness changes.
class AthenaPalette {
  const AthenaPalette({
    required this.background,
    required this.surface,
    required this.surfaceElevated,
    required this.border,
    required this.ink,
    required this.paper,
    required this.primary,
    required this.accent,
    required this.bullish,
    required this.bearish,
    required this.hold,
    required this.textPrimary,
    required this.textSecondary,
  });

  final Color background;
  final Color surface;
  final Color surfaceElevated;
  final Color border;
  final Color ink;
  final Color paper;
  final Color primary;
  final Color accent;
  final Color bullish;
  final Color bearish;
  final Color hold;
  final Color textPrimary;
  final Color textSecondary;

  static const light = AthenaPalette(
    background: Color(0xFFF3EDE3),
    surface: Color(0xFFFAF6EF),
    surfaceElevated: Color(0xFFFFFFFF),
    border: Color(0xFFD6CBB8),
    ink: Color(0xFF1C1915),
    paper: Color(0xFFF3EDE3),
    primary: Color(0xFF1C1915),
    accent: Color(0xFF6B5A3E),
    bullish: Color(0xFF1F6B4A),
    bearish: Color(0xFF9B2C2C),
    hold: Color(0xFF8A6A2F),
    textPrimary: Color(0xFF1C1915),
    textSecondary: Color(0xFF6B6458),
  );

  /// Deep ink classical dark — not neon crypto.
  static const dark = AthenaPalette(
    background: Color(0xFF12100E),
    surface: Color(0xFF1C1915),
    surfaceElevated: Color(0xFF26221C),
    border: Color(0xFF3A342C),
    ink: Color(0xFFF3EDE3),
    paper: Color(0xFF12100E),
    primary: Color(0xFFF3EDE3),
    accent: Color(0xFFB8A88A),
    bullish: Color(0xFF3D9B6E),
    bearish: Color(0xFFD45A5A),
    hold: Color(0xFFC4A35A),
    textPrimary: Color(0xFFF3EDE3),
    textSecondary: Color(0xFFA89F90),
  );
}

/// Bound palette used across screens (updates when theme toggles).
class AppColors {
  static AthenaPalette _p = AthenaPalette.light;

  static void bind(Brightness brightness) {
    _p = brightness == Brightness.dark ? AthenaPalette.dark : AthenaPalette.light;
  }

  static Color get background => _p.background;
  static Color get surface => _p.surface;
  static Color get surfaceElevated => _p.surfaceElevated;
  static Color get border => _p.border;
  static Color get ink => _p.ink;
  static Color get paper => _p.paper;
  static Color get primary => _p.primary;
  static Color get accent => _p.accent;
  static Color get bullish => _p.bullish;
  static Color get bearish => _p.bearish;
  static Color get hold => _p.hold;
  static Color get textPrimary => _p.textPrimary;
  static Color get textSecondary => _p.textSecondary;
}

class AppTypography {
  static const displayFamily = 'Fraunces';
  static const bodyFamily = 'Source Sans 3';
}

class AppTheme {
  static ThemeData light() => _build(AthenaPalette.light, Brightness.light);

  static ThemeData dark() => _build(AthenaPalette.dark, Brightness.dark);

  static ThemeData _build(AthenaPalette p, Brightness brightness) {
    final display = GoogleFonts.frauncesTextTheme();
    final body = GoogleFonts.sourceSans3TextTheme();
    final textTheme = body.copyWith(
      displayLarge: display.displayLarge?.copyWith(color: p.textPrimary, fontWeight: FontWeight.w600),
      displayMedium: display.displayMedium?.copyWith(color: p.textPrimary, fontWeight: FontWeight.w600),
      displaySmall: display.displaySmall?.copyWith(color: p.textPrimary, fontWeight: FontWeight.w600),
      headlineLarge: display.headlineLarge?.copyWith(color: p.textPrimary, fontWeight: FontWeight.w600),
      headlineMedium: display.headlineMedium?.copyWith(color: p.textPrimary, fontWeight: FontWeight.w600),
      headlineSmall: display.headlineSmall?.copyWith(color: p.textPrimary, fontWeight: FontWeight.w600),
      titleLarge: display.titleLarge?.copyWith(color: p.textPrimary, fontWeight: FontWeight.w600),
      titleMedium: body.titleMedium?.copyWith(color: p.textPrimary, fontWeight: FontWeight.w600),
      titleSmall: body.titleSmall?.copyWith(color: p.textPrimary, fontWeight: FontWeight.w600),
      bodyLarge: body.bodyLarge?.copyWith(color: p.textPrimary, height: 1.45),
      bodyMedium: body.bodyMedium?.copyWith(color: p.textPrimary, height: 1.45),
      bodySmall: body.bodySmall?.copyWith(color: p.textSecondary, height: 1.4),
      labelLarge: body.labelLarge?.copyWith(color: p.textPrimary, fontWeight: FontWeight.w600),
    );

    final base = ThemeData(
      useMaterial3: true,
      brightness: brightness,
      scaffoldBackgroundColor: p.background,
      textTheme: textTheme,
      colorScheme: brightness == Brightness.light
          ? ColorScheme.light(
              primary: p.ink,
              onPrimary: p.paper,
              secondary: p.accent,
              surface: p.surface,
              error: p.bearish,
              onSurface: p.textPrimary,
            )
          : ColorScheme.dark(
              primary: p.ink,
              onPrimary: p.paper,
              secondary: p.accent,
              surface: p.surface,
              error: p.bearish,
              onSurface: p.textPrimary,
            ),
    );

    return base.copyWith(
      appBarTheme: AppBarTheme(
        backgroundColor: p.background,
        foregroundColor: p.ink,
        elevation: 0,
        centerTitle: false,
        scrolledUnderElevation: 0,
        titleTextStyle: display.titleLarge?.copyWith(
          color: p.ink,
          fontWeight: FontWeight.w600,
          fontSize: 22,
        ),
      ),
      cardTheme: CardTheme(
        color: p.surface,
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(4),
          side: BorderSide(color: p.border, width: 1),
        ),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: p.ink,
          foregroundColor: p.paper,
          padding: const EdgeInsets.symmetric(vertical: 16, horizontal: 24),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(4)),
          textStyle: const TextStyle(fontWeight: FontWeight.w600, fontSize: 16),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: p.surfaceElevated,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(4),
          borderSide: BorderSide(color: p.border),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(4),
          borderSide: BorderSide(color: p.border),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(4),
          borderSide: BorderSide(color: p.ink, width: 1.5),
        ),
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      ),
      bottomNavigationBarTheme: BottomNavigationBarThemeData(
        backgroundColor: p.surface,
        selectedItemColor: p.ink,
        unselectedItemColor: p.textSecondary,
        type: BottomNavigationBarType.fixed,
        elevation: 0,
      ),
      dividerTheme: DividerThemeData(color: p.border, thickness: 1),
      chipTheme: ChipThemeData(
        backgroundColor: p.surface,
        selectedColor: p.ink,
        labelStyle: textTheme.labelLarge!,
        secondaryLabelStyle: textTheme.labelLarge!.copyWith(color: p.paper),
        side: BorderSide(color: p.border),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(4)),
      ),
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
