import 'package:athena/core/constants/app_constants.dart';
import 'package:athena/core/theme/app_theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  setUp(() => AppColors.bind(Brightness.light));

  group('directionLabel', () {
    test('maps known directions', () {
      expect(directionLabel('BUY_CALL'), 'BUY CALL');
      expect(directionLabel('BUY_PUT'), 'BUY PUT');
      expect(directionLabel('HOLD'), 'HOLD');
    });

    test('falls back to HOLD for unknown values', () {
      expect(directionLabel('UNKNOWN'), 'HOLD');
    });
  });

  group('directionColor', () {
    test('returns bullish / bearish / hold colors', () {
      expect(directionColor('BUY_CALL'), AppColors.bullish);
      expect(directionColor('BUY_PUT'), AppColors.bearish);
      expect(directionColor('HOLD'), AppColors.hold);
    });
  });

  test('manual execution disclaimer is present', () {
    expect(AppConstants.manualExecutionDisclaimer, contains('manual'));
  });

  test('dark palette binds different background', () {
    AppColors.bind(Brightness.light);
    final lightBg = AppColors.background;
    AppColors.bind(Brightness.dark);
    expect(AppColors.background, isNot(lightBg));
  });
}
