import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:fl_chart/fl_chart.dart';
import '../../core/theme/app_theme.dart';
import '../../core/providers.dart';
import '../../core/constants/app_constants.dart';

class ChartsScreen extends ConsumerWidget {
  const ChartsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final symbol = ref.watch(selectedSymbolProvider);
    final timeframe = ref.watch(selectedTimeframeProvider);
    final signalAsync = ref.watch(latestSignalProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Charts')),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SizedBox(
              height: 40,
              child: ListView(
                scrollDirection: Axis.horizontal,
                children: AppConstants.supportedSymbols
                    .map((s) => Padding(
                          padding: const EdgeInsets.only(right: 8),
                          child: ChoiceChip(
                            label: Text(s),
                            selected: s == symbol,
                            onSelected: (_) => ref.read(selectedSymbolProvider.notifier).state = s,
                          ),
                        ))
                    .toList(),
              ),
            ),
            const SizedBox(height: 16),
            Text('$symbol · $timeframe', style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
            const SizedBox(height: 16),
            Expanded(
              child: signalAsync.when(
                data: (signal) => Container(
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    color: AppColors.surface,
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(color: AppColors.border),
                  ),
                  child: Column(
                    children: [
                      Expanded(
                        child: LineChart(
                          LineChartData(
                            gridData: const FlGridData(show: false),
                            titlesData: const FlTitlesData(show: false),
                            borderData: FlBorderData(show: false),
                            lineBarsData: [
                              LineChartBarData(
                                spots: [
                                  FlSpot(0, signal.entryRange.low),
                                  FlSpot(1, signal.price),
                                  FlSpot(2, signal.target1),
                                  FlSpot(3, signal.target2),
                                ],
                                isCurved: true,
                                color: directionColor(signal.direction),
                                barWidth: 3,
                                dotData: const FlDotData(show: true),
                              ),
                            ],
                          ),
                        ),
                      ),
                      const SizedBox(height: 8),
                      const Text(
                        'Simplified price path: entry → current → target 1 → target 2. '
                        'For full OHLCV candlesticks, wire this widget to a candlestick chart library '
                        'backed by /api/market/prices historical candles.',
                        style: TextStyle(fontSize: 11, color: AppColors.textSecondary),
                      ),
                    ],
                  ),
                ),
                loading: () => const Center(child: CircularProgressIndicator()),
                error: (e, _) => Center(child: Text('Error: $e')),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
