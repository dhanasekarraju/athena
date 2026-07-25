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
    final theme = Theme.of(context);
    final symbol = ref.watch(selectedSymbolProvider);
    final timeframe = ref.watch(selectedTimeframeProvider);
    final signalAsync = ref.watch(latestSignalProvider);
    final statusAsync = ref.watch(botStatusProvider);
    final pricesAsync = ref.watch(marketPricesProvider);

    return Scaffold(
      body: RefreshIndicator(
        onRefresh: () async {
          ref.invalidate(latestSignalProvider);
          ref.invalidate(marketPricesProvider);
          ref.invalidate(botStatusProvider);
          ref.invalidate(botConfigProvider);
        },
        child: ListView(
          padding: const EdgeInsets.fromLTRB(20, 12, 20, 32),
          children: [
            SafeArea(
              bottom: false,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'ATHENA',
                    style: theme.textTheme.displaySmall?.copyWith(
                      fontFamily: AppTypography.displayFamily,
                      fontWeight: FontWeight.w600,
                      letterSpacing: 1.2,
                      height: 1.05,
                    ),
                  ),
                  const SizedBox(height: 6),
                  Text(
                    'Your options child · Delta India',
                    style: theme.textTheme.bodyMedium?.copyWith(color: AppColors.textSecondary),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 20),

            statusAsync.when(
              data: (status) {
                final auto = status['autonomous'] == true || status['autonomousEnabled'] == true;
                final paper = status['paperTrading'] == true;
                final open = (status['openPositions'] as List?) ?? [];
                return Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      auto
                          ? (paper ? 'Auto on · paper' : 'Auto on · live')
                          : 'Auto off',
                      style: theme.textTheme.titleMedium?.copyWith(
                        fontFamily: AppTypography.displayFamily,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      open.isEmpty
                          ? 'No open positions — watching.'
                          : '${open.length} open · conf floor ${(status['minConfidence'] as num?)?.toStringAsFixed(0) ?? '—'}',
                      style: theme.textTheme.bodySmall,
                    ),
                    const SizedBox(height: 16),
                    if (open.isNotEmpty) ...[
                      Text('Open book', style: theme.textTheme.titleMedium?.copyWith(
                        fontFamily: AppTypography.displayFamily,
                      )),
                      const SizedBox(height: 10),
                      ...open.map((raw) {
                        final p = Map<String, dynamic>.from(raw as Map);
                        final dir = p['direction']?.toString() ?? '';
                        final sym = p['productSymbol']?.toString() ?? '';
                        final entry = (p['entryPremium'] as num?)?.toDouble();
                        final snap = p['signalSnapshot'];
                        String tf = '';
                        String conf = '';
                        if (snap is Map) {
                          tf = snap['timeframe']?.toString() ?? '';
                          conf = snap['confidence']?.toString() ?? '';
                        }
                        return Container(
                          width: double.infinity,
                          margin: const EdgeInsets.only(bottom: 10),
                          padding: const EdgeInsets.all(14),
                          decoration: BoxDecoration(
                            color: AppColors.surface,
                            border: Border.all(color: AppColors.border),
                            borderRadius: BorderRadius.circular(4),
                          ),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                sym,
                                style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700),
                              ),
                              const SizedBox(height: 4),
                              Text(
                                '${directionLabel(dir)} · entry ${entry?.toStringAsFixed(2) ?? '—'}'
                                '${tf.isNotEmpty ? ' · $tf' : ''}'
                                '${conf.isNotEmpty ? ' · conf $conf' : ''}',
                                style: theme.textTheme.bodySmall?.copyWith(color: directionColor(dir)),
                              ),
                            ],
                          ),
                        );
                      }),
                      const SizedBox(height: 8),
                    ],
                  ],
                );
              },
              loading: () => const Padding(
                padding: EdgeInsets.symmetric(vertical: 12),
                child: LinearProgressIndicator(minHeight: 2),
              ),
              error: (_, __) => Text(
                'Could not load bot status',
                style: theme.textTheme.bodySmall?.copyWith(color: AppColors.bearish),
              ),
            ),

            const DisclaimerBanner(),
            const SizedBox(height: 16),

            pricesAsync.when(
              data: (prices) => Row(
                children: AppConstants.supportedSymbols.map((s) {
                  final price = prices[s];
                  return Expanded(
                    child: Padding(
                      padding: const EdgeInsets.only(right: 8),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(s, style: theme.textTheme.bodySmall),
                          Text(
                            price != null ? '\$${price.toStringAsFixed(0)}' : '—',
                            style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700),
                          ),
                        ],
                      ),
                    ),
                  );
                }).toList(),
              ),
              loading: () => const SizedBox.shrink(),
              error: (_, __) => const SizedBox.shrink(),
            ),
            const SizedBox(height: 20),

            SizedBox(
              height: 36,
              child: ListView(
                scrollDirection: Axis.horizontal,
                children: [
                  ...AppConstants.supportedSymbols.map((s) {
                    final selected = s == symbol;
                    return Padding(
                      padding: const EdgeInsets.only(right: 8),
                      child: ChoiceChip(
                        label: Text(s),
                        selected: selected,
                        onSelected: (_) => ref.read(selectedSymbolProvider.notifier).state = s,
                        labelStyle: TextStyle(color: selected ? AppColors.paper : AppColors.ink),
                        selectedColor: AppColors.ink,
                      ),
                    );
                  }),
                  ...AppConstants.timeframes.map((tf) {
                    final selected = tf == timeframe;
                    return Padding(
                      padding: const EdgeInsets.only(right: 8),
                      child: ChoiceChip(
                        label: Text(tf),
                        selected: selected,
                        onSelected: (_) => ref.read(selectedTimeframeProvider.notifier).state = tf,
                        labelStyle: TextStyle(color: selected ? AppColors.paper : AppColors.ink),
                        selectedColor: AppColors.ink,
                      ),
                    );
                  }),
                ],
              ),
            ),
            const SizedBox(height: 16),

            Text('Signal', style: theme.textTheme.titleMedium?.copyWith(
              fontFamily: AppTypography.displayFamily,
            )),
            const SizedBox(height: 10),
            signalAsync.when(
              data: (signal) => SignalCard(
                signal: signal,
                onTap: () => context.push('/signal-details'),
              ),
              loading: () => const Padding(
                padding: EdgeInsets.symmetric(vertical: 24),
                child: Center(child: CircularProgressIndicator()),
              ),
              error: (err, _) => Text('Could not load signal: $err',
                  style: const TextStyle(color: AppColors.bearish)),
            ),
            const SizedBox(height: 16),
            TextButton(
              onPressed: () => context.go('/charts'),
              child: const Text('Open charts'),
            ),
          ],
        ),
      ),
    );
  }
}
