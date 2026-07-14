import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/theme/app_theme.dart';
import '../../core/providers.dart';
import '../../core/constants/app_constants.dart';

class WatchlistScreen extends ConsumerWidget {
  const WatchlistScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final pricesAsync = ref.watch(marketPricesProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Watchlist')),
      body: pricesAsync.when(
        data: (prices) => ListView.separated(
          padding: const EdgeInsets.all(16),
          itemCount: AppConstants.supportedSymbols.length,
          separatorBuilder: (_, __) => const SizedBox(height: 10),
          itemBuilder: (context, i) {
            final symbol = AppConstants.supportedSymbols[i];
            final price = prices[symbol];
            return Container(
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: AppColors.surface,
                borderRadius: BorderRadius.circular(14),
                border: Border.all(color: AppColors.border),
              ),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(symbol, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
                  Text(price != null ? '\$${price.toStringAsFixed(2)}' : '—',
                      style: const TextStyle(fontWeight: FontWeight.w600)),
                  IconButton(
                    onPressed: () {
                      ref.read(selectedSymbolProvider.notifier).state = symbol;
                    },
                    icon: const Icon(Icons.chevron_right, color: AppColors.textSecondary),
                  ),
                ],
              ),
            );
          },
        ),
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(child: Text('Error: $e')),
      ),
    );
  }
}
