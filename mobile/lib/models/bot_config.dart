class BotConfig {
  final bool autonomousEnabled;
  final bool paperTrading;
  final double maxOrderInr;
  final double maxOpenExposureInr;
  final double minConfidence;
  final List<String> symbols;
  final double slFraction;
  final double tp1Fraction;
  final bool skipHighRisk;
  final bool killed;
  final bool deltaConfigured;

  BotConfig({
    required this.autonomousEnabled,
    required this.paperTrading,
    required this.maxOrderInr,
    required this.maxOpenExposureInr,
    required this.minConfidence,
    required this.symbols,
    required this.slFraction,
    required this.tp1Fraction,
    required this.skipHighRisk,
    required this.killed,
    required this.deltaConfigured,
  });

  factory BotConfig.fromJson(Map<String, dynamic> json) => BotConfig(
        autonomousEnabled: json['autonomousEnabled'] as bool? ?? false,
        paperTrading: json['paperTrading'] as bool? ?? true,
        maxOrderInr: (json['maxOrderInr'] as num?)?.toDouble() ?? 1000,
        maxOpenExposureInr: (json['maxOpenExposureInr'] as num?)?.toDouble() ?? 2000,
        minConfidence: (json['minConfidence'] as num?)?.toDouble() ?? 55,
        symbols: (json['symbols'] as List?)?.map((e) => e.toString()).toList() ?? const ['BTC', 'ETH'],
        slFraction: (json['slFraction'] as num?)?.toDouble() ?? 0.4,
        tp1Fraction: (json['tp1Fraction'] as num?)?.toDouble() ?? 0.5,
        skipHighRisk: json['skipHighRisk'] as bool? ?? true,
        killed: json['killed'] as bool? ?? false,
        deltaConfigured: json['deltaConfigured'] as bool? ?? false,
      );

  Map<String, dynamic> toPatch() => {
        'autonomousEnabled': autonomousEnabled,
        'paperTrading': paperTrading,
        'maxOrderInr': maxOrderInr,
        'maxOpenExposureInr': maxOpenExposureInr,
        'minConfidence': minConfidence,
        'symbols': symbols,
        'slFraction': slFraction,
        'tp1Fraction': tp1Fraction,
        'skipHighRisk': skipHighRisk,
      };

  BotConfig copyWith({
    bool? autonomousEnabled,
    bool? paperTrading,
    double? maxOrderInr,
    double? maxOpenExposureInr,
    double? minConfidence,
    List<String>? symbols,
    double? slFraction,
    double? tp1Fraction,
    bool? skipHighRisk,
    bool? killed,
    bool? deltaConfigured,
  }) {
    return BotConfig(
      autonomousEnabled: autonomousEnabled ?? this.autonomousEnabled,
      paperTrading: paperTrading ?? this.paperTrading,
      maxOrderInr: maxOrderInr ?? this.maxOrderInr,
      maxOpenExposureInr: maxOpenExposureInr ?? this.maxOpenExposureInr,
      minConfidence: minConfidence ?? this.minConfidence,
      symbols: symbols ?? this.symbols,
      slFraction: slFraction ?? this.slFraction,
      tp1Fraction: tp1Fraction ?? this.tp1Fraction,
      skipHighRisk: skipHighRisk ?? this.skipHighRisk,
      killed: killed ?? this.killed,
      deltaConfigured: deltaConfigured ?? this.deltaConfigured,
    );
  }
}
