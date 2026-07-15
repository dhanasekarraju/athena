class BotActivityEvent {
  final String id;
  final DateTime at;
  final String level;
  final String message;
  final String? symbol;
  final Map<String, dynamic>? details;

  BotActivityEvent({
    required this.id,
    required this.at,
    required this.level,
    required this.message,
    this.symbol,
    this.details,
  });

  factory BotActivityEvent.fromJson(Map<String, dynamic> json) => BotActivityEvent(
        id: json['id'] as String? ?? '',
        at: DateTime.tryParse(json['at'] as String? ?? '') ?? DateTime.now(),
        level: json['level'] as String? ?? 'info',
        message: json['message'] as String? ?? '',
        symbol: json['symbol'] as String?,
        details: json['details'] is Map
            ? Map<String, dynamic>.from(json['details'] as Map)
            : null,
      );
}

class BotOpenPosition {
  final String id;
  final String underlying;
  final String direction;
  final String productSymbol;
  final double entryPremium;
  final double size;
  final bool paper;
  final DateTime openedAt;

  BotOpenPosition({
    required this.id,
    required this.underlying,
    required this.direction,
    required this.productSymbol,
    required this.entryPremium,
    required this.size,
    required this.paper,
    required this.openedAt,
  });

  factory BotOpenPosition.fromJson(Map<String, dynamic> json) => BotOpenPosition(
        id: json['id'] as String? ?? '',
        underlying: json['underlying'] as String? ?? '',
        direction: json['direction'] as String? ?? '',
        productSymbol: json['productSymbol'] as String? ?? '',
        entryPremium: (json['entryPremium'] as num?)?.toDouble() ?? 0,
        size: (json['size'] as num?)?.toDouble() ?? 0,
        paper: json['paper'] as bool? ?? true,
        openedAt: DateTime.tryParse(json['openedAt'] as String? ?? '') ?? DateTime.now(),
      );
}

class BotLiveLog {
  final bool autonomous;
  final bool paper;
  final bool killed;
  final double minConfidence;
  final bool deltaConfigured;
  final List<BotOpenPosition> openPositions;
  final List<BotActivityEvent> events;

  BotLiveLog({
    required this.autonomous,
    required this.paper,
    required this.killed,
    required this.minConfidence,
    required this.deltaConfigured,
    required this.openPositions,
    required this.events,
  });

  factory BotLiveLog.fromJson(Map<String, dynamic> json) {
    final status = Map<String, dynamic>.from(json['status'] as Map? ?? {});
    return BotLiveLog(
      autonomous: status['autonomous'] as bool? ?? false,
      paper: status['paper'] as bool? ?? true,
      killed: status['killed'] as bool? ?? false,
      minConfidence: (status['minConfidence'] as num?)?.toDouble() ?? 55,
      deltaConfigured: status['deltaConfigured'] as bool? ?? false,
      openPositions: (json['openPositions'] as List? ?? [])
          .whereType<Map>()
          .map((e) => BotOpenPosition.fromJson(Map<String, dynamic>.from(e)))
          .toList(),
      events: (json['events'] as List? ?? [])
          .whereType<Map>()
          .map((e) => BotActivityEvent.fromJson(Map<String, dynamic>.from(e)))
          .toList(),
    );
  }
}
