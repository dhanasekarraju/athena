import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/theme/app_theme.dart';
import '../../core/providers.dart';

final portfolioStatsProvider = FutureProvider.autoDispose<Map<String, dynamic>>((ref) async {
  final api = ref.watch(apiClientProvider);
  final res = await api.dio.get('/api/portfolio');
  return Map<String, dynamic>.from(res.data as Map);
});

class PortfolioScreen extends ConsumerWidget {
  const PortfolioScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final statsAsync = ref.watch(portfolioStatsProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Portfolio'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: () => ref.invalidate(portfolioStatsProvider),
          ),
        ],
      ),
      body: statsAsync.when(
        data: (stats) {
          final open = (stats['openPositions'] as List? ?? []).whereType<Map>().toList();
          final recent = (stats['recentClosed'] as List? ?? []).whereType<Map>().toList();
          final pnl = (stats['totalPnl'] as num?)?.toDouble() ?? 0;
          return RefreshIndicator(
            onRefresh: () async => ref.invalidate(portfolioStatsProvider),
            child: ListView(
              padding: const EdgeInsets.all(16),
              children: [
                GridView.count(
                  shrinkWrap: true,
                  physics: const NeverScrollableScrollPhysics(),
                  crossAxisCount: 2,
                  crossAxisSpacing: 12,
                  mainAxisSpacing: 12,
                  childAspectRatio: 1.45,
                  children: [
                    _statCard('Win Rate', '${stats['winRate']}%', AppColors.bullish),
                    _statCard(
                      'Closed P&L',
                      pnl.toStringAsFixed(2),
                      pnl >= 0 ? AppColors.bullish : AppColors.bearish,
                    ),
                    _statCard('Closed trades', '${stats['totalTrades']}', AppColors.textPrimary),
                    _statCard(
                      'Open',
                      '${stats['openCount'] ?? 0}',
                      AppColors.primary,
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                Text(
                  'Open ≈ ₹${(stats['openNotional'] as num?)?.toStringAsFixed(0) ?? '0'}'
                  ' · uPnL ₹${(stats['openUnrealizedPnl'] as num?)?.toStringAsFixed(0) ?? '0'}'
                  ' · Paper ${stats['openPaper'] ?? 0} / Live ${stats['openLive'] ?? 0}',
                  style: const TextStyle(fontSize: 12, color: AppColors.textSecondary),
                ),
                const SizedBox(height: 20),
                const Text('Open bot positions',
                    style: TextStyle(fontWeight: FontWeight.w700, fontSize: 15)),
                const SizedBox(height: 8),
                if (open.isEmpty)
                  _emptyBox('No open bot trades yet. Check Live Log for skips / fills.')
                else
                  ...open.map((m) => _positionCard(Map<String, dynamic>.from(m), open: true)),
                const SizedBox(height: 20),
                const Text('Recent closed',
                    style: TextStyle(fontWeight: FontWeight.w700, fontSize: 15)),
                const SizedBox(height: 8),
                if (recent.isEmpty)
                  _emptyBox('No closed bot trades yet.')
                else
                  ...recent.map((m) => _positionCard(Map<String, dynamic>.from(m), open: false)),
              ],
            ),
          );
        },
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(child: Text('Error: $e')),
      ),
    );
  }

  Widget _emptyBox(String text) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.border),
      ),
      child: Text(text, style: const TextStyle(color: AppColors.textSecondary, fontSize: 13)),
    );
  }

  Widget _positionCard(Map<String, dynamic> p, {required bool open}) {
    final paper = p['paper'] == true;
    final direction = p['direction']?.toString() ?? '';
    final product = p['productSymbol']?.toString() ?? '';
    final underlying = p['underlying']?.toString() ?? '';
    final size = (p['size'] as num?)?.toDouble() ?? 0;
    final entry = (p['entryPremium'] as num?)?.toDouble() ?? 0;
    final exit = (p['exitPremium'] as num?)?.toDouble();
    final pnl = (p['realizedPnl'] as num?)?.toDouble();
    final reason = p['exitReason']?.toString();
    final sl = (p['stopLoss'] as num?)?.toDouble();
    final tp = (p['takeProfit1'] as num?)?.toDouble();
    final entryCostLabel = (p['entryCostInr'] as num?)?.toStringAsFixed(0);
    final markPremium = (p['markPremium'] as num?)?.toDouble();
    final unrealized = (p['unrealizedPnlInr'] as num?)?.toDouble();

    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            '${paper ? 'PAPER' : 'LIVE'} · $underlying $direction',
            style: const TextStyle(fontWeight: FontWeight.w700),
          ),
          const SizedBox(height: 4),
          Text(
            entryCostLabel == null
                ? '$product ×${size.toStringAsFixed(0)} @ ${entry.toStringAsFixed(2)}'
                : '$product ×${size.toStringAsFixed(0)} @ ${entry.toStringAsFixed(2)} · ≈₹$entryCostLabel',
            style: const TextStyle(fontSize: 13),
          ),
          if (open) ...[
            if (markPremium != null) ...[
              const SizedBox(height: 4),
              Text(
                'mark ${markPremium.toStringAsFixed(2)} · uPnL ₹${unrealized?.toStringAsFixed(0) ?? '—'}',
                style: TextStyle(
                  fontSize: 12,
                  color: (unrealized ?? 0) >= 0 ? AppColors.bullish : AppColors.bearish,
                ),
              ),
            ],
            if (sl != null && tp != null) ...[
              const SizedBox(height: 4),
              Text(
                'SL ${sl.toStringAsFixed(2)} · TP ${tp.toStringAsFixed(2)}',
                style: const TextStyle(fontSize: 12, color: AppColors.textSecondary),
              ),
            ],
          ],
          if (!open) ...[
            const SizedBox(height: 4),
            Text(
              [
                if (exit != null) 'exit ${exit.toStringAsFixed(2)}',
                if (reason != null) reason,
                if (pnl != null) 'pnl ₹${pnl.toStringAsFixed(0)}',
              ].join(' · '),
              style: TextStyle(
                fontSize: 12,
                color: (pnl ?? 0) >= 0 ? AppColors.bullish : AppColors.bearish,
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _statCard(String label, String value, Color color) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Text(label, style: const TextStyle(fontSize: 12, color: AppColors.textSecondary)),
          const SizedBox(height: 6),
          Text(value, style: TextStyle(fontSize: 22, fontWeight: FontWeight.w800, color: color)),
        ],
      ),
    );
  }
}
