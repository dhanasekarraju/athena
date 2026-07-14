import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/theme/app_theme.dart';
import '../../core/providers.dart';

final portfolioStatsProvider = FutureProvider.autoDispose((ref) async {
  final api = ref.watch(apiClientProvider);
  final res = await api.dio.get('/api/portfolio');
  return Map<String, dynamic>.from(res.data);
});

class PortfolioScreen extends ConsumerWidget {
  const PortfolioScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final statsAsync = ref.watch(portfolioStatsProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Portfolio')),
      body: statsAsync.when(
        data: (stats) => Padding(
          padding: const EdgeInsets.all(16),
          child: GridView.count(
            crossAxisCount: 2,
            crossAxisSpacing: 12,
            mainAxisSpacing: 12,
            childAspectRatio: 1.5,
            children: [
              _statCard('Win Rate', '${stats['winRate']}%', AppColors.bullish),
              _statCard('Total P&L', '\$${stats['totalPnl']}', (stats['totalPnl'] ?? 0) >= 0 ? AppColors.bullish : AppColors.bearish),
              _statCard('Trades', '${stats['totalTrades']}', AppColors.textPrimary),
              _statCard('Wins / Losses', '${stats['wins']} / ${stats['losses']}', AppColors.textPrimary),
            ],
          ),
        ),
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(child: Text('Error: $e')),
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
