import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/theme/app_theme.dart';
import '../../core/providers.dart';
import '../../models/trade_model.dart';

final tradeHistoryProvider = FutureProvider.autoDispose<List<Trade>>((ref) async {
  final api = ref.watch(apiClientProvider);
  final res = await api.dio.get('/api/trades/history');
  return (res.data['trades'] as List).map((t) => Trade.fromJson(t)).toList();
});

class JournalScreen extends ConsumerWidget {
  const JournalScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final tradesAsync = ref.watch(tradeHistoryProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Trade Journal')),
      floatingActionButton: FloatingActionButton(
        onPressed: () => _showAddTradeSheet(context, ref),
        child: const Icon(Icons.add),
      ),
      body: tradesAsync.when(
        data: (trades) {
          if (trades.isEmpty) {
            return const Center(
              child: Text('No trades logged yet.\nManually record trades you execute on your exchange.',
                  textAlign: TextAlign.center, style: TextStyle(color: AppColors.textSecondary)),
            );
          }
          return ListView.separated(
            padding: const EdgeInsets.all(16),
            itemCount: trades.length,
            separatorBuilder: (_, __) => const SizedBox(height: 10),
            itemBuilder: (context, i) {
              final t = trades[i];
              final pnlColor = (t.pnl ?? 0) >= 0 ? AppColors.bullish : AppColors.bearish;
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
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('${t.symbol} · ${directionLabel(t.direction)}',
                            style: const TextStyle(fontWeight: FontWeight.w700)),
                        const SizedBox(height: 4),
                        Text('Entry \$${t.entryPrice.toStringAsFixed(2)} · Qty ${t.quantity}',
                            style: const TextStyle(fontSize: 12, color: AppColors.textSecondary)),
                      ],
                    ),
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.end,
                      children: [
                        Text(t.status, style: const TextStyle(fontSize: 11, color: AppColors.textSecondary)),
                        if (t.pnl != null)
                          Text('\$${t.pnl!.toStringAsFixed(2)}',
                              style: TextStyle(fontWeight: FontWeight.w700, color: pnlColor)),
                      ],
                    ),
                  ],
                ),
              );
            },
          );
        },
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(child: Text('Error: $e')),
      ),
    );
  }

  void _showAddTradeSheet(BuildContext context, WidgetRef ref) {
    final symbolCtrl = TextEditingController(text: 'BTC');
    final entryCtrl = TextEditingController();
    final qtyCtrl = TextEditingController();
    String direction = 'BUY_CALL';

    showModalBottomSheet(
      context: context,
      backgroundColor: AppColors.surface,
      isScrollControlled: true,
      builder: (ctx) => Padding(
        padding: EdgeInsets.only(
          left: 20, right: 20, top: 20,
          bottom: MediaQuery.of(ctx).viewInsets.bottom + 20,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text('Log Manual Trade', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
            const SizedBox(height: 4),
            const Text('Record a trade you already executed on your exchange. ATHENA does not place orders.',
                style: TextStyle(fontSize: 12, color: AppColors.textSecondary)),
            const SizedBox(height: 16),
            TextField(controller: symbolCtrl, decoration: const InputDecoration(hintText: 'Symbol (e.g. BTC)')),
            const SizedBox(height: 10),
            TextField(controller: entryCtrl, keyboardType: TextInputType.number, decoration: const InputDecoration(hintText: 'Entry price')),
            const SizedBox(height: 10),
            TextField(controller: qtyCtrl, keyboardType: TextInputType.number, decoration: const InputDecoration(hintText: 'Quantity')),
            const SizedBox(height: 16),
            ElevatedButton(
              onPressed: () async {
                final api = ref.read(apiClientProvider);
                await api.dio.post('/api/trades', data: {
                  'symbol': symbolCtrl.text.trim().toUpperCase(),
                  'direction': direction,
                  'entryPrice': double.tryParse(entryCtrl.text) ?? 0,
                  'quantity': double.tryParse(qtyCtrl.text) ?? 0,
                });
                ref.invalidate(tradeHistoryProvider);
                if (ctx.mounted) Navigator.pop(ctx);
              },
              child: const Text('Save Trade'),
            ),
          ],
        ),
      ),
    );
  }
}
