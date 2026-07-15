import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/theme/app_theme.dart';
import '../../core/providers.dart';

final portfolioStatsProvider = FutureProvider.autoDispose<Map<String, dynamic>>((ref) async {
  final api = ref.watch(apiClientProvider);
  final res = await api.dio.get('/api/portfolio');
  return Map<String, dynamic>.from(res.data as Map);
});

class PortfolioScreen extends ConsumerStatefulWidget {
  const PortfolioScreen({super.key});

  @override
  ConsumerState<PortfolioScreen> createState() => _PortfolioScreenState();
}

class _PortfolioScreenState extends ConsumerState<PortfolioScreen> {
  Timer? _timer;
  String? _closingId;

  @override
  void initState() {
    super.initState();
    _timer = Timer.periodic(const Duration(seconds: 5), (_) {
      if (!mounted) return;
      ref.invalidate(portfolioStatsProvider);
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  Future<void> _closePosition(String id) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Close position?'),
        content: const Text('Sells at current mark (paper or live). This cannot be undone.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          TextButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Close')),
        ],
      ),
    );
    if (ok != true) return;
    setState(() => _closingId = id);
    try {
      final result = await ref.read(botServiceProvider).closePosition(id);
      if (!mounted) return;
      final pnl = (result['pnl'] as num?)?.toDouble();
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            pnl == null
                ? 'Position closed'
                : 'Closed · PnL ≈ ₹${pnl.toStringAsFixed(0)}',
          ),
        ),
      );
      ref.invalidate(portfolioStatsProvider);
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Close failed: $e')),
      );
    } finally {
      if (mounted) setState(() => _closingId = null);
    }
  }

  @override
  Widget build(BuildContext context) {
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
          final available = (stats['availableBalanceInr'] as num?)?.toDouble() ?? 0;
          final totalPnl = (stats['totalPnlInr'] as num?)?.toDouble() ??
              (stats['totalPnl'] as num?)?.toDouble() ??
              0;
          final unrealized = (stats['openUnrealizedPnl'] as num?)?.toDouble() ?? 0;
          final balanceLabel = stats['balanceLabel']?.toString() ?? 'Available';
          final paperMode = stats['paperMode'] == true;

          return RefreshIndicator(
            onRefresh: () async => ref.invalidate(portfolioStatsProvider),
            child: ListView(
              padding: const EdgeInsets.all(16),
              children: [
                Row(
                  children: [
                    Expanded(
                      child: _heroBox(
                        balanceLabel,
                        '₹${available.toStringAsFixed(0)}',
                        AppColors.primary,
                        subtitle: paperMode
                            ? 'Start ₹${(stats['paperStartInr'] as num?)?.toStringAsFixed(0) ?? '10000'}'
                            : 'Delta USD ${(stats['deltaUsdAvailable'] as num?)?.toStringAsFixed(2) ?? '—'}',
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: _heroBox(
                        'Total P&L',
                        '₹${totalPnl.toStringAsFixed(0)}',
                        totalPnl >= 0 ? AppColors.bullish : AppColors.bearish,
                        subtitle: 'uPnL ₹${unrealized.toStringAsFixed(0)} · auto 5s',
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                GridView.count(
                  shrinkWrap: true,
                  physics: const NeverScrollableScrollPhysics(),
                  crossAxisCount: 2,
                  crossAxisSpacing: 12,
                  mainAxisSpacing: 12,
                  childAspectRatio: 1.55,
                  children: [
                    _statCard('Win Rate', '${stats['winRate']}%', AppColors.bullish),
                    _statCard(
                      'Closed P&L',
                      '₹${((stats['realizedPnlInr'] as num?) ?? (stats['totalPnl'] as num?) ?? 0).toStringAsFixed(0)}',
                      AppColors.textPrimary,
                    ),
                    _statCard('Closed trades', '${stats['totalTrades']}', AppColors.textPrimary),
                    _statCard('Open', '${stats['openCount'] ?? 0}', AppColors.primary),
                  ],
                ),
                const SizedBox(height: 8),
                Text(
                  'Open tied ≈ ₹${(stats['openNotional'] as num?)?.toStringAsFixed(0) ?? '0'}'
                  ' · Equity ≈ ₹${(stats['equityInr'] as num?)?.toStringAsFixed(0) ?? '—'}'
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

  Widget _heroBox(String label, String value, Color color, {String? subtitle}) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: const TextStyle(fontSize: 12, color: AppColors.textSecondary)),
          const SizedBox(height: 8),
          Text(value, style: TextStyle(fontSize: 26, fontWeight: FontWeight.w800, color: color)),
          if (subtitle != null) ...[
            const SizedBox(height: 6),
            Text(subtitle, style: const TextStyle(fontSize: 11, color: AppColors.textSecondary)),
          ],
        ],
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
    final id = p['id']?.toString() ?? '';
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
    final closing = _closingId == id;

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
          Row(
            children: [
              Expanded(
                child: Text(
                  '${paper ? 'PAPER' : 'LIVE'} · $underlying $direction',
                  style: const TextStyle(fontWeight: FontWeight.w700),
                ),
              ),
              if (open)
                TextButton(
                  onPressed: closing || id.isEmpty ? null : () => _closePosition(id),
                  style: TextButton.styleFrom(foregroundColor: AppColors.bearish),
                  child: closing
                      ? const SizedBox(
                          width: 16,
                          height: 16,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Text('Close'),
                ),
            ],
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
