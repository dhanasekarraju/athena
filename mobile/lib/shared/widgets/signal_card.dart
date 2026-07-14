import 'package:flutter/material.dart';
import '../../core/theme/app_theme.dart';
import '../../models/signal_model.dart';

class SignalCard extends StatelessWidget {
  final Signal signal;
  final VoidCallback? onTap;

  const SignalCard({super.key, required this.signal, this.onTap});

  @override
  Widget build(BuildContext context) {
    final color = directionColor(signal.direction);
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(16),
      child: Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: AppColors.border),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Row(
                  children: [
                    Text(signal.symbol,
                        style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
                    const SizedBox(width: 8),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                      decoration: BoxDecoration(
                        color: AppColors.surfaceElevated,
                        borderRadius: BorderRadius.circular(6),
                      ),
                      child: Text(signal.timeframe,
                          style: const TextStyle(fontSize: 11, color: AppColors.textSecondary)),
                    ),
                  ],
                ),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                  decoration: BoxDecoration(
                    color: color.withOpacity(0.15),
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: Text(
                    directionLabel(signal.direction),
                    style: TextStyle(color: color, fontWeight: FontWeight.w700, fontSize: 13),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 14),
            Row(
              children: [
                _stat('Confidence', '${signal.confidence.toStringAsFixed(0)}%', color),
                const SizedBox(width: 24),
                _stat('Risk', signal.riskLevel, AppColors.textPrimary),
                const SizedBox(width: 24),
                _stat('Price', '\$${signal.price.toStringAsFixed(2)}', AppColors.textPrimary),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _stat(String label, String value, Color color) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: const TextStyle(fontSize: 11, color: AppColors.textSecondary)),
        const SizedBox(height: 2),
        Text(value, style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: color)),
      ],
    );
  }
}
