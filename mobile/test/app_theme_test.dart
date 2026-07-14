import 'package:athena/core/constants/app_constants.dart';
import 'package:athena/core/theme/app_theme.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
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
}
