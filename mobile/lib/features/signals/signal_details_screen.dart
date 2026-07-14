import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/theme/app_theme.dart';
import '../../core/providers.dart';
import '../../shared/widgets/disclaimer_banner.dart';

class SignalDetailsScreen extends ConsumerWidget {
  const SignalDetailsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final signalAsync = ref.watch(latestSignalProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Signal Details')),
      body: signalAsync.when(
        data: (signal) {
          final color = directionColor(signal.direction);
          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              const DisclaimerBanner(),
              const SizedBox(height: 16),
              Container(
                padding: const EdgeInsets.all(20),
                decoration: BoxDecoration(
                  color: AppColors.surface,
                  borderRadius: BorderRadius.circular(18),
                  border: Border.all(color: color.withOpacity(0.4)),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('${signal.symbol} · ${signal.timeframe}',
                        style: const TextStyle(color: AppColors.textSecondary)),
                    const SizedBox(height: 6),
                    Text(directionLabel(signal.direction),
                        style: TextStyle(fontSize: 30, fontWeight: FontWeight.w800, color: color)),
                    const SizedBox(height: 4),
                    Text('Confidence ${signal.confidence.toStringAsFixed(0)}%  ·  ${signal.riskLevel} Risk',
                        style: const TextStyle(fontSize: 15, color: AppColors.textPrimary)),
                  ],
                ),
              ),
              const SizedBox(height: 20),
              const Text('Reasons', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
              const SizedBox(height: 10),
              ...signal.reasons.map((r) => Padding(
                    padding: const EdgeInsets.only(bottom: 8),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Icon(Icons.check_circle, size: 16, color: color),
                        const SizedBox(width: 8),
                        Expanded(child: Text(r)),
                      ],
                    ),
                  )),
              const SizedBox(height: 20),
              const Text('Trade Plan', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
              const SizedBox(height: 12),
              _planRow('Entry Range', '\$${signal.entryRange.low.toStringAsFixed(2)} – \$${signal.entryRange.high.toStringAsFixed(2)}'),
              _planRow('Target 1', '\$${signal.target1.toStringAsFixed(2)}'),
              _planRow('Target 2', '\$${signal.target2.toStringAsFixed(2)}'),
              _planRow('Stop Loss', '\$${signal.stopLoss.toStringAsFixed(2)}'),
              if (signal.insufficientData) ...[
                const SizedBox(height: 16),
                const Text(
                  'Note: limited historical data for this pair/timeframe — confidence may be less reliable.',
                  style: TextStyle(color: AppColors.hold, fontSize: 12),
                ),
              ],
            ],
          );
        },
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (err, _) => Center(child: Text('Error: $err')),
      ),
    );
  }

  Widget _planRow(String label, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: const TextStyle(color: AppColors.textSecondary)),
          Text(value, style: const TextStyle(fontWeight: FontWeight.w600)),
        ],
      ),
    );
  }
}
