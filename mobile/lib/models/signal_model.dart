class EntryRange {
  final double low;
  final double high;
  EntryRange({required this.low, required this.high});
  factory EntryRange.fromJson(Map<String, dynamic> json) =>
      EntryRange(low: (json['low'] as num).toDouble(), high: (json['high'] as num).toDouble());
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
  });

  factory Signal.fromJson(Map<String, dynamic> json) => Signal(
        symbol: json['symbol'] as String,
        timeframe: json['timeframe'] as String,
        direction: json['direction'] as String,
        confidence: (json['confidence'] as num).toDouble(),
        riskLevel: json['risk_level'] as String,
        entryRange: EntryRange.fromJson(json['entry_range'] as Map<String, dynamic>),
        target1: (json['target_1'] as num).toDouble(),
        target2: (json['target_2'] as num).toDouble(),
        stopLoss: (json['stop_loss'] as num).toDouble(),
        reasons: (json['reasons'] as List).map((e) => e.toString()).toList(),
        price: (json['price'] as num?)?.toDouble() ?? 0,
        insufficientData: json['insufficient_data'] as bool? ?? false,
      );
}
