class EntryRange {
  final double low;
  final double high;
  EntryRange({required this.low, required this.high});
  factory EntryRange.fromJson(Map<String, dynamic> json) =>
      EntryRange(low: (json['low'] as num).toDouble(), high: (json['high'] as num).toDouble());
}

class UnderlyingPlan {
  final EntryRange entryRange;
  final double target1;
  final double target2;
  final double stopLoss;

  UnderlyingPlan({
    required this.entryRange,
    required this.target1,
    required this.target2,
    required this.stopLoss,
  });

  factory UnderlyingPlan.fromJson(Map<String, dynamic> json) => UnderlyingPlan(
        entryRange: EntryRange.fromJson(json['entry_range'] as Map<String, dynamic>),
        target1: (json['target_1'] as num).toDouble(),
        target2: (json['target_2'] as num).toDouble(),
        stopLoss: (json['stop_loss'] as num).toDouble(),
      );
}

class PremiumPlan {
  final double entryLow;
  final double entryHigh;
  final double target1;
  final double target2;
  final double stopLoss;

  PremiumPlan({
    required this.entryLow,
    required this.entryHigh,
    required this.target1,
    required this.target2,
    required this.stopLoss,
  });

  factory PremiumPlan.fromJson(Map<String, dynamic> json) => PremiumPlan(
        entryLow: (json['entry_low'] as num).toDouble(),
        entryHigh: (json['entry_high'] as num).toDouble(),
        target1: (json['target_1'] as num).toDouble(),
        target2: (json['target_2'] as num).toDouble(),
        stopLoss: (json['stop_loss'] as num).toDouble(),
      );
}

class OptionContract {
  final String venue;
  final String instrumentName;
  final String optionType; // call | put
  final double strike;
  final DateTime expiry;
  final double daysToExpiry;
  final double premiumCoin;
  final double premiumUsd;
  final double? markIv;
  final double? bidUsd;
  final double? askUsd;
  final double openInterest;

  OptionContract({
    required this.venue,
    required this.instrumentName,
    required this.optionType,
    required this.strike,
    required this.expiry,
    required this.daysToExpiry,
    required this.premiumCoin,
    required this.premiumUsd,
    required this.markIv,
    required this.bidUsd,
    required this.askUsd,
    required this.openInterest,
  });

  factory OptionContract.fromJson(Map<String, dynamic> json) => OptionContract(
        venue: json['venue'] as String? ?? 'deribit',
        instrumentName: json['instrument_name'] as String,
        optionType: json['option_type'] as String,
        strike: (json['strike'] as num).toDouble(),
        expiry: DateTime.parse(json['expiry'] as String),
        daysToExpiry: (json['days_to_expiry'] as num).toDouble(),
        premiumCoin: (json['premium_coin'] as num).toDouble(),
        premiumUsd: (json['premium_usd'] as num).toDouble(),
        markIv: (json['mark_iv'] as num?)?.toDouble(),
        bidUsd: (json['bid_usd'] as num?)?.toDouble(),
        askUsd: (json['ask_usd'] as num?)?.toDouble(),
        openInterest: (json['open_interest'] as num?)?.toDouble() ?? 0,
      );

  String get shortLabel {
    final side = optionType.toLowerCase() == 'put' ? 'P' : 'C';
    final strikeLabel = strike >= 1000
        ? strike.toStringAsFixed(0)
        : strike.toStringAsFixed(strike == strike.roundToDouble() ? 0 : 2);
    return '$strikeLabel$side · ${daysToExpiry.toStringAsFixed(0)}D · \$${premiumUsd.toStringAsFixed(0)}';
  }
}

class Signal {
  final String symbol;
  final String timeframe;
  final String direction; // BUY_CALL | BUY_PUT | HOLD
  final double confidence;
  final String riskLevel; // Low | Medium | High
  final EntryRange entryRange;
  final double target1;
  final double target2;
  final double stopLoss;
  final List<String> reasons;
  final double price;
  final bool insufficientData;
  final UnderlyingPlan underlyingPlan;
  final OptionContract? option;
  final PremiumPlan? premiumPlan;

  Signal({
    required this.symbol,
    required this.timeframe,
    required this.direction,
    required this.confidence,
    required this.riskLevel,
    required this.entryRange,
    required this.target1,
    required this.target2,
    required this.stopLoss,
    required this.reasons,
    required this.price,
    required this.insufficientData,
    required this.underlyingPlan,
    required this.option,
    required this.premiumPlan,
  });

  factory Signal.fromJson(Map<String, dynamic> json) {
    final entryRange = EntryRange.fromJson(json['entry_range'] as Map<String, dynamic>);
    final target1 = (json['target_1'] as num).toDouble();
    final target2 = (json['target_2'] as num).toDouble();
    final stopLoss = (json['stop_loss'] as num).toDouble();

    final underlyingJson = json['underlying_plan'] as Map<String, dynamic>?;
    final underlyingPlan = underlyingJson != null
        ? UnderlyingPlan.fromJson(underlyingJson)
        : UnderlyingPlan(
            entryRange: entryRange,
            target1: target1,
            target2: target2,
            stopLoss: stopLoss,
          );

    final optionJson = json['option'];
    final premiumJson = json['premium_plan'];

    return Signal(
      symbol: json['symbol'] as String,
      timeframe: json['timeframe'] as String,
      direction: json['direction'] as String,
      confidence: (json['confidence'] as num).toDouble(),
      riskLevel: json['risk_level'] as String,
      entryRange: entryRange,
      target1: target1,
      target2: target2,
      stopLoss: stopLoss,
      reasons: (json['reasons'] as List).map((e) => e.toString()).toList(),
      price: (json['price'] as num?)?.toDouble() ?? 0,
      insufficientData: json['insufficient_data'] as bool? ?? false,
      underlyingPlan: underlyingPlan,
      option: optionJson is Map<String, dynamic> ? OptionContract.fromJson(optionJson) : null,
      premiumPlan: premiumJson is Map<String, dynamic> ? PremiumPlan.fromJson(premiumJson) : null,
    );
  }
}
