import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/theme/app_theme.dart';
import '../../core/providers.dart';
import '../../models/bot_live_log.dart';

class LiveLogScreen extends ConsumerStatefulWidget {
  const LiveLogScreen({super.key});

  @override
  ConsumerState<LiveLogScreen> createState() => _LiveLogScreenState();
}

class _LiveLogScreenState extends ConsumerState<LiveLogScreen> {
  BotLiveLog? _log;
  String? _error;
  bool _loading = true;
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    _refresh();
    _timer = Timer.periodic(const Duration(seconds: 4), (_) => _refresh());
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  Future<void> _refresh() async {
    try {
      final log = await ref.read(botServiceProvider).getLiveLog();
      if (!mounted) return;
      setState(() {
        _log = log;
        _error = null;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString();
        _loading = false;
      });
    }
  }

  Color _levelColor(String level) {
    switch (level) {
      case 'trade':
        return AppColors.bullish;
      case 'exit':
        return AppColors.primary;
      case 'skip':
        return AppColors.hold;
      case 'error':
        return AppColors.bearish;
      default:
        return AppColors.textSecondary;
    }
  }

  IconData _levelIcon(String level) {
    switch (level) {
      case 'trade':
        return Icons.shopping_cart_checkout;
      case 'exit':
        return Icons.logout;
      case 'skip':
        return Icons.block;
      case 'error':
        return Icons.error_outline;
      default:
        return Icons.info_outline;
    }
  }

  String _ago(DateTime at) {
    final d = DateTime.now().difference(at.toLocal());
    if (d.inSeconds < 60) return '${d.inSeconds}s';
    if (d.inMinutes < 60) return '${d.inMinutes}m';
    return '${d.inHours}h';
  }

  @override
  Widget build(BuildContext context) {
    final log = _log;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Live Log'),
        actions: [
          IconButton(
            onPressed: _refresh,
            icon: const Icon(Icons.refresh),
            tooltip: 'Refresh',
          ),
        ],
      ),
      body: _loading && log == null
          ? const Center(child: CircularProgressIndicator())
          : _error != null && log == null
              ? Center(
                  child: Padding(
                    padding: const EdgeInsets.all(24),
                    child: Text(
                      'Could not load bot log.\n$_error',
                      textAlign: TextAlign.center,
                      style: const TextStyle(color: AppColors.textSecondary),
                    ),
                  ),
                )
              : RefreshIndicator(
                  onRefresh: _refresh,
                  child: ListView(
                    padding: const EdgeInsets.all(16),
                    children: [
                      if (log != null) _statusCard(log),
                      if (log != null && log.openPositions.isNotEmpty) ...[
                        const SizedBox(height: 16),
                        const Text('Open positions',
                            style: TextStyle(fontWeight: FontWeight.w700, fontSize: 15)),
                        const SizedBox(height: 8),
                        ...log.openPositions.map(_positionTile),
                      ],
                      const SizedBox(height: 16),
                      const Text('Activity',
                          style: TextStyle(fontWeight: FontWeight.w700, fontSize: 15)),
                      const SizedBox(height: 6),
                      const Text(
                        'Skips, paper/live fills, and exits. Auto-refreshes every 4s.',
                        style: TextStyle(fontSize: 12, color: AppColors.textSecondary),
                      ),
                      const SizedBox(height: 10),
                      if (log == null || log.events.isEmpty)
                        Container(
                          padding: const EdgeInsets.all(16),
                          decoration: BoxDecoration(
                            color: AppColors.surface,
                            borderRadius: BorderRadius.circular(12),
                            border: Border.all(color: AppColors.border),
                          ),
                          child: const Text(
                            'No events yet. Pull a BTC/ETH signal with Auto ON to see skips or trades here.',
                            style: TextStyle(color: AppColors.textSecondary),
                          ),
                        )
                      else
                        ...log.events.map(_eventTile),
                    ],
                  ),
                ),
    );
  }

  Widget _statusCard(BotLiveLog log) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            [
              log.autonomous ? 'Auto ON' : 'Auto OFF',
              log.paper ? 'Paper' : 'LIVE',
              if (log.killed) 'KILLED',
              'min conf ${log.minConfidence.toStringAsFixed(0)}',
            ].join(' · '),
            style: const TextStyle(fontWeight: FontWeight.w700),
          ),
          const SizedBox(height: 4),
          Text(
            log.deltaConfigured ? 'Delta connected' : 'Delta keys missing',
            style: const TextStyle(fontSize: 12, color: AppColors.textSecondary),
          ),
        ],
      ),
    );
  }

  Widget _positionTile(BotOpenPosition p) {
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.border),
      ),
      child: Text(
        '${p.paper ? 'PAPER' : 'LIVE'} ${p.direction} ${p.productSymbol} ×${p.size.toStringAsFixed(0)} @ ${p.entryPremium.toStringAsFixed(2)}',
        style: const TextStyle(fontWeight: FontWeight.w600),
      ),
    );
  }

  Widget _eventTile(BotActivityEvent e) {
    final color = _levelColor(e.level);
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.border),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(_levelIcon(e.level), size: 18, color: color),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(e.message, style: const TextStyle(fontSize: 13, height: 1.3)),
                const SizedBox(height: 4),
                Text(
                  '${e.level.toUpperCase()} · ${_ago(e.at)} ago',
                  style: TextStyle(fontSize: 11, color: color),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
