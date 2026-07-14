import 'package:athena/models/signal_model.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('Signal.fromJson', () {
    test('parses full Deribit option + dual plans', () {
      final signal = Signal.fromJson({
        'symbol': 'BTC',
        'timeframe': '15m',
        'direction': 'BUY_CALL',
        'confidence': 82.0,
        'risk_level': 'Medium',
        'entry_range': {'low': 94900.0, 'high': 95100.0},
        'target_1': 96000.0,
        'target_2': 97000.0,
        'stop_loss': 94000.0,
        'underlying_plan': {
          'entry_range': {'low': 94900.0, 'high': 95100.0},
          'target_1': 96000.0,
          'target_2': 97000.0,
          'stop_loss': 94000.0,
        },
        'option': {
          'venue': 'deribit',
          'instrument_name': 'BTC-28MAR25-96000-C',
          'option_type': 'call',
          'strike': 96000,
          'expiry': '2025-03-28T08:00:00Z',
          'days_to_expiry': 7.0,
          'premium_coin': 0.012,
          'premium_usd': 1140.0,
          'mark_iv': 0.55,
          'bid_usd': 1100.0,
          'ask_usd': 1180.0,
          'open_interest': 50.0,
        },
        'premium_plan': {
          'entry_low': 1100.0,
          'entry_high': 1180.0,
          'target_1': 1710.0,
          'target_2': 2280.0,
          'stop_loss': 684.0,
        },
        'reasons': ['RSI oversold'],
        'price': 95000.0,
        'insufficient_data': false,
      });

      expect(signal.option, isNotNull);
      expect(signal.option!.instrumentName, 'BTC-28MAR25-96000-C');
      expect(signal.option!.strike, 96000);
      expect(signal.premiumPlan, isNotNull);
      expect(signal.premiumPlan!.target1, 1710.0);
      expect(signal.underlyingPlan.stopLoss, 94000.0);
      expect(signal.option!.shortLabel, contains('96000C'));
    });

    test('HOLD / empty option chain leaves option and premiumPlan null', () {
      final signal = Signal.fromJson({
        'symbol': 'SOL',
        'timeframe': '15m',
        'direction': 'HOLD',
        'confidence': 40.0,
        'risk_level': 'Low',
        'entry_range': {'low': 100.0, 'high': 100.0},
        'target_1': 100.0,
        'target_2': 100.0,
        'stop_loss': 100.0,
        'option': null,
        'premium_plan': null,
        'reasons': ['No suitable Deribit options contract found'],
        'price': 100.0,
        'insufficient_data': false,
      });

      expect(signal.option, isNull);
      expect(signal.premiumPlan, isNull);
      expect(signal.underlyingPlan.entryRange.low, 100.0);
      expect(signal.reasons, contains('No suitable Deribit options contract found'));
    });

    test('falls back to top-level levels when underlying_plan missing', () {
      final signal = Signal.fromJson({
        'symbol': 'ETH',
        'timeframe': '1h',
        'direction': 'BUY_PUT',
        'confidence': 70.0,
        'risk_level': 'High',
        'entry_range': {'low': 3400.0, 'high': 3450.0},
        'target_1': 3300.0,
        'target_2': 3200.0,
        'stop_loss': 3550.0,
        'reasons': [],
        'price': 3425.0,
      });

      expect(signal.underlyingPlan.target1, 3300.0);
      expect(signal.underlyingPlan.stopLoss, 3550.0);
      expect(signal.option, isNull);
    });
  });
}
