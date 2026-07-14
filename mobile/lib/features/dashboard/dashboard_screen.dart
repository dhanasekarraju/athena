import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../core/theme/app_theme.dart';
import '../../core/providers.dart';
import '../../core/constants/app_constants.dart';
import '../../shared/widgets/signal_card.dart';
import '../../shared/widgets/disclaimer_banner.dart';

class DashboardScreen extends ConsumerWidget {
  const DashboardScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final symbol = ref.watch(selectedSymbolProvider);
    final timeframe = ref.watch(selectedTimeframeProvider);
    final signalAsync = ref.watch(latestSignalProvider);
    final pricesAsync = ref.watch(marketPricesProvider);
    final fearGreedAsync = ref.watch(fearGreedProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('ATHENA')),
      body: RefreshIndicator(
        onRefresh: () async {
          ref.invalidate(latestSignalProvider);
          ref.invalidate(marketPricesProvider);
          ref.invalidate(fearGreedProvider);
        },
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            const DisclaimerBanner(),
            const SizedBox(height: 16),

            // Live prices strip
            pricesAsync.when(
              data: (prices) => SizedBox(
                height: 72,
                child: Row(
                  children: AppConstants.supportedSymbols.map((s) {
                    final price = prices[s];
                    return Expanded(
                      child: Container(
                        margin: const EdgeInsets.only(right: 8),
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: AppColors.surface,
                          borderRadius: BorderRadius.circular(14),
                          border: Border.all(color: AppColors.border),
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(s, style: const TextStyle(color: AppColors.textSecondary, fontSize: 12)),
                            const SizedBox(height: 4),
                            Text(price != null ? '\$${price.toStringAsFixed(2)}' : '—',
                                style: const TextStyle(fontWeight: FontWeight.w700)),
                          ],
                        ),
                      ),
                    );
                  }).toList(),
                ),
              ),
              loading: () => const SizedBox(height: 72, child: Center(child: CircularProgressIndicator())),
              error: (_, __) => const SizedBox(height: 72, child: Center(child: Text('Prices unavailable'))),
            ),
            const SizedBox(height: 16),

            // Fear & Greed
            fearGreedAsync.maybeWhen(
              data: (fg) => Container(
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  color: AppColors.surface,
                  borderRadius: BorderRadius.circular(14),
                  border: Border.all(color: AppColors.border),
                ),
                child: Row(
                  children: [
                    const Icon(Icons.speed, color: AppColors.primary, size: 20),
                    const SizedBox(width: 10),
                    Text('Fear & Greed: ${fg['value']} (${fg['classification']})',
                        style: const TextStyle(fontWeight: FontWeight.w600)),
                  ],
                ),
              ),
              orElse: () => const SizedBox.shrink(),
            ),
            const SizedBox(height: 20),

            // Symbol selector
            SizedBox(
              height: 40,
              child: ListView(
                scrollDirection: Axis.horizontal,
                children: AppConstants.supportedSymbols.map((s) {
                  final selected = s == symbol;
                  return Padding(
                    padding: const EdgeInsets.only(right: 8),
                    child: ChoiceChip(
                      label: Text(s),
                      selected: selected,
                      onSelected: (_) => ref.read(selectedSymbolProvider.notifier).state = s,
                    ),
                  );
                }).toList(),
              ),
            ),
            const SizedBox(height: 10),
            SizedBox(
              height: 36,
              child: ListView(
                scrollDirection: Axis.horizontal,
                children: AppConstants.timeframes.map((tf) {
                  final selected = tf == timeframe;
                  return Padding(
                    padding: const EdgeInsets.only(right: 8),
                    child: ChoiceChip(
                      label: Text(tf),
                      selected: selected,
                      onSelected: (_) => ref.read(selectedTimeframeProvider.notifier).state = tf,
                    ),
                  );
                }).toList(),
              ),
            ),
            const SizedBox(height: 20),

            const Text('Current Signal', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
            const SizedBox(height: 12),
            signalAsync.when(
              data: (signal) => SignalCard(
                signal: signal,
                onTap: () => context.push('/signal-details'),
              ),
              loading: () => const Padding(
                padding: EdgeInsets.symmetric(vertical: 32),
                child: Center(child: CircularProgressIndicator()),
              ),
              error: (err, _) => Padding(
                padding: const EdgeInsets.symmetric(vertical: 24),
                child: Text('Could not load signal: $err',
                    style: const TextStyle(color: AppColors.bearish)),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
