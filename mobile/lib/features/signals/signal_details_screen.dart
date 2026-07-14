import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import '../../core/theme/app_theme.dart';
import '../../core/providers.dart';
import '../../models/signal_model.dart';
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
          final underlying = signal.underlyingPlan;
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
                    if (signal.option != null) ...[
                      const SizedBox(height: 8),
                      Text(
                        signal.option!.shortLabel,
                        style: const TextStyle(fontSize: 13, color: AppColors.textSecondary),
                      ),
                    ],
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
              _ContractSection(option: signal.option),
              const SizedBox(height: 20),
              _PremiumPlanSection(plan: signal.premiumPlan),
              const SizedBox(height: 20),
              const Text('Underlying plan (spot)', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
              const SizedBox(height: 4),
              const Text(
                'Spot invalidation levels — not option premium.',
                style: TextStyle(fontSize: 12, color: AppColors.textSecondary),
              ),
              const SizedBox(height: 12),
              _planRow(
                'Entry Range',
                '\$${underlying.entryRange.low.toStringAsFixed(2)} – \$${underlying.entryRange.high.toStringAsFixed(2)}',
              ),
              _planRow('Target 1', '\$${underlying.target1.toStringAsFixed(2)}'),
              _planRow('Target 2', '\$${underlying.target2.toStringAsFixed(2)}'),
              _planRow('Stop Loss', '\$${underlying.stopLoss.toStringAsFixed(2)}'),
              if (signal.insufficientData) ...[
                const SizedBox(height: 16),
                const Text(
                  'Note: limited historical data for this pair/timeframe — confidence may be less reliable.',
                  style: TextStyle(color: AppColors.hold, fontSize: 12),
                ),
              ],
              const SizedBox(height: 16),
              const Text(
                'Recommendations only. Execute manually on Deribit (or your venue). ATHENA never places orders.',
                style: TextStyle(fontSize: 12, color: AppColors.textSecondary),
              ),
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

class _ContractSection extends StatelessWidget {
  final OptionContract? option;
  const _ContractSection({required this.option});

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text('Contract (Deribit)', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
        const SizedBox(height: 12),
        if (option == null)
          const Text(
            'No Deribit options contract selected for this signal.',
            style: TextStyle(color: AppColors.textSecondary, fontSize: 13),
          )
        else ...[
          _row('Instrument', option!.instrumentName),
          _row('Type', option!.optionType.toUpperCase()),
          _row('Strike', '\$${option!.strike.toStringAsFixed(option!.strike >= 1000 ? 0 : 2)}'),
          _row('Expiry', DateFormat('dd MMM yyyy').format(option!.expiry.toLocal())),
          _row('DTE', '${option!.daysToExpiry.toStringAsFixed(1)} days'),
          _row(
            'Premium',
            '\$${option!.premiumUsd.toStringAsFixed(2)}  (${option!.premiumCoin.toStringAsFixed(6)} coin)',
          ),
          if (option!.markIv != null)
            _row('Mark IV', '${(option!.markIv! * 100).toStringAsFixed(1)}%'),
          if (option!.bidUsd != null && option!.askUsd != null)
            _row(
              'Bid / Ask',
              '\$${option!.bidUsd!.toStringAsFixed(2)} / \$${option!.askUsd!.toStringAsFixed(2)}',
            ),
        ],
      ],
    );
  }

  Widget _row(String label, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 100,
            child: Text(label, style: const TextStyle(color: AppColors.textSecondary)),
          ),
          Expanded(
            child: Text(value, style: const TextStyle(fontWeight: FontWeight.w600), textAlign: TextAlign.right),
          ),
        ],
      ),
    );
  }
}

class _PremiumPlanSection extends StatelessWidget {
  final PremiumPlan? plan;
  const _PremiumPlanSection({required this.plan});

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text('Premium plan (option price)', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
        const SizedBox(height: 4),
        const Text(
          'Manage the long option by premium: TP +50% / +100%, SL −40%.',
          style: TextStyle(fontSize: 12, color: AppColors.textSecondary),
        ),
        const SizedBox(height: 12),
        if (plan == null)
          const Text(
            'Premium plan unavailable until a contract is selected.',
            style: TextStyle(color: AppColors.textSecondary, fontSize: 13),
          )
        else ...[
          _row('Entry', '\$${plan!.entryLow.toStringAsFixed(2)} – \$${plan!.entryHigh.toStringAsFixed(2)}'),
          _row('Target 1', '\$${plan!.target1.toStringAsFixed(2)}'),
          _row('Target 2', '\$${plan!.target2.toStringAsFixed(2)}'),
          _row('Stop Loss', '\$${plan!.stopLoss.toStringAsFixed(2)}'),
        ],
      ],
    );
  }

  Widget _row(String label, String value) {
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
