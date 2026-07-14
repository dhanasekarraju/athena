class Trade {
  final String id;
  final String symbol;
  final String direction;
  final double entryPrice;
  final double? exitPrice;
  final double quantity;
  final double? pnl;
  final String status;
  final DateTime openedAt;
  final DateTime? closedAt;

  Trade({
    required this.id,
    required this.symbol,
    required this.direction,
    required this.entryPrice,
    this.exitPrice,
    required this.quantity,
    this.pnl,
    required this.status,
    required this.openedAt,
    this.closedAt,
  });

  factory Trade.fromJson(Map<String, dynamic> json) => Trade(
        id: json['id'],
        symbol: json['symbol'],
        direction: json['direction'],
        entryPrice: (json['entryPrice'] as num).toDouble(),
        exitPrice: (json['exitPrice'] as num?)?.toDouble(),
        quantity: (json['quantity'] as num).toDouble(),
        pnl: (json['pnl'] as num?)?.toDouble(),
        status: json['status'],
        openedAt: DateTime.parse(json['openedAt']),
        closedAt: json['closedAt'] != null ? DateTime.parse(json['closedAt']) : null,
      );
}

class AthenaUser {
  final String id;
  final String email;
  AthenaUser({required this.id, required this.email});
  factory AthenaUser.fromJson(Map<String, dynamic> json) =>
      AthenaUser(id: json['id'], email: json['email']);
}
