import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../core/theme/app_theme.dart';
import '../../core/providers.dart';
import '../../core/constants/app_constants.dart';
import '../../models/bot_config.dart';

class SettingsScreen extends ConsumerStatefulWidget {
  const SettingsScreen({super.key});

  @override
  ConsumerState<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends ConsumerState<SettingsScreen> {
  BotConfig? _draft;
  bool _saving = false;
  String? _error;
  String? _savedMsg;

  Future<void> _save() async {
    final draft = _draft;
    if (draft == null) return;
    setState(() {
      _saving = true;
      _error = null;
      _savedMsg = null;
    });
    try {
      final saved = await ref.read(botServiceProvider).updateConfig(draft);
      setState(() {
        _draft = saved;
        _savedMsg = 'Saved. Bot will use these limits on the next signal.';
      });
      ref.invalidate(botConfigProvider);
    } catch (e) {
      final msg = e.toString();
      final unauthorized = msg.contains('401') || msg.contains('Unauthorized');
      setState(() => _error = unauthorized
          ? 'Session expired — sign out and log in again, then Save.'
          : 'Save failed: $msg');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _kill() async {
    await ref.read(botServiceProvider).kill();
    ref.invalidate(botConfigProvider);
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Kill switch ON — no new auto buys')),
      );
    }
  }

  Future<void> _resume() async {
    await ref.read(botServiceProvider).resume();
    ref.invalidate(botConfigProvider);
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Kill switch OFF — auto buys can resume')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final configAsync = ref.watch(botConfigProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Settings')),
      body: configAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (err, _) => ListView(
          padding: const EdgeInsets.all(16),
          children: [
            const Text(
              'Could not load bot config. Log in and ensure the backend is running.',
              style: TextStyle(color: AppColors.textSecondary),
            ),
            const SizedBox(height: 16),
            _signOutTile(context),
          ],
        ),
        data: (cfg) {
          _draft ??= cfg;
          final draft = _draft!;
          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              _sectionCard(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('Auto trade (Delta options)',
                        style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
                    const SizedBox(height: 6),
                    Text(
                      draft.deltaConfigured
                          ? 'Delta API keys detected on server.'
                          : 'Delta API keys not set on server — only paper mode works.',
                      style: const TextStyle(fontSize: 12, color: AppColors.textSecondary),
                    ),
                    SwitchListTile(
                      contentPadding: EdgeInsets.zero,
                      title: const Text('Enable auto trade'),
                      subtitle: const Text('Buy CALL/PUT from signals within your limits'),
                      value: draft.autonomousEnabled,
                      onChanged: (v) => setState(() => _draft = draft.copyWith(autonomousEnabled: v)),
                    ),
                    SwitchListTile(
                      contentPadding: EdgeInsets.zero,
                      title: const Text('Paper trading'),
                      subtitle: const Text('ON = simulate only. OFF = real Delta orders'),
                      value: draft.paperTrading,
                      onChanged: (v) => setState(() => _draft = draft.copyWith(paperTrading: v)),
                    ),
                    SwitchListTile(
                      contentPadding: EdgeInsets.zero,
                      title: const Text('Skip High risk signals'),
                      value: draft.skipHighRisk,
                      onChanged: (v) => setState(() => _draft = draft.copyWith(skipHighRisk: v)),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 14),
              _sectionCard(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('Money limits (₹)', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
                    const SizedBox(height: 12),
                    _numberField(
                      label: 'Max per buy',
                      value: draft.maxOrderInr,
                      onChanged: (v) => setState(() => _draft = draft.copyWith(maxOrderInr: v)),
                    ),
                    const SizedBox(height: 10),
                    _numberField(
                      label: 'Max open exposure',
                      value: draft.maxOpenExposureInr,
                      onChanged: (v) => setState(() => _draft = draft.copyWith(maxOpenExposureInr: v)),
                    ),
                    const SizedBox(height: 10),
                    _numberField(
                      label: 'Min confidence %',
                      value: draft.minConfidence,
                      onChanged: (v) => setState(() => _draft = draft.copyWith(minConfidence: v)),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 14),
              _sectionCard(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('Exit rules', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
                    const SizedBox(height: 8),
                    Text(
                      'Stop loss: −${(draft.slFraction * 100).toStringAsFixed(0)}%  ·  Take profit: +${(draft.tp1Fraction * 100).toStringAsFixed(0)}%',
                      style: const TextStyle(color: AppColors.textSecondary, fontSize: 13),
                    ),
                    Slider(
                      value: draft.slFraction.clamp(0.1, 0.8),
                      min: 0.1,
                      max: 0.8,
                      divisions: 14,
                      label: 'SL −${(draft.slFraction * 100).round()}%',
                      onChanged: (v) => setState(() => _draft = draft.copyWith(slFraction: v)),
                    ),
                    Slider(
                      value: draft.tp1Fraction.clamp(0.2, 2.0),
                      min: 0.2,
                      max: 2.0,
                      divisions: 18,
                      label: 'TP +${(draft.tp1Fraction * 100).round()}%',
                      onChanged: (v) => setState(() => _draft = draft.copyWith(tp1Fraction: v)),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 14),
              _sectionCard(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('Symbols', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
                    const SizedBox(height: 8),
                    Wrap(
                      spacing: 8,
                      children: AppConstants.supportedSymbols.map((sym) {
                        final selected = draft.symbols.contains(sym);
                        return FilterChip(
                          label: Text(sym),
                          selected: selected,
                          onSelected: (on) {
                            final next = [...draft.symbols];
                            if (on) {
                              if (!next.contains(sym)) next.add(sym);
                            } else {
                              next.remove(sym);
                            }
                            setState(() => _draft = draft.copyWith(symbols: next));
                          },
                        );
                      }).toList(),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 16),
              if (_error != null)
                Text(_error!, style: const TextStyle(color: AppColors.bearish, fontSize: 13)),
              if (_savedMsg != null)
                Text(_savedMsg!, style: const TextStyle(color: AppColors.bullish, fontSize: 13)),
              const SizedBox(height: 8),
              ElevatedButton(
                onPressed: _saving ? null : _save,
                child: Text(_saving ? 'Saving…' : 'Save bot settings'),
              ),
              const SizedBox(height: 10),
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton(
                      onPressed: _kill,
                      child: const Text('Kill switch'),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: OutlinedButton(
                      onPressed: _resume,
                      child: const Text('Resume'),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 20),
              const Text(
                'Tips: keep Paper ON until a few dry runs look correct. Turn Auto ON only with ₹ you can lose. '
                'Kill switch blocks new buys; existing positions still exit on SL/TP.',
                style: TextStyle(fontSize: 12, color: AppColors.textSecondary),
              ),
              const Divider(height: 32),
              _signOutTile(context),
            ],
          );
        },
      ),
    );
  }

  Widget _sectionCard({required Widget child}) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.border),
      ),
      child: child,
    );
  }

  Widget _numberField({
    required String label,
    required double value,
    required ValueChanged<double> onChanged,
  }) {
    return TextFormField(
      initialValue: value.toStringAsFixed(value == value.roundToDouble() ? 0 : 1),
      keyboardType: const TextInputType.numberWithOptions(decimal: true),
      decoration: InputDecoration(labelText: label),
      onChanged: (raw) {
        final v = double.tryParse(raw);
        if (v != null) onChanged(v);
      },
    );
  }

  Widget _signOutTile(BuildContext context) {
    return ListTile(
      leading: const Icon(Icons.logout, color: AppColors.bearish),
      title: const Text('Sign Out', style: TextStyle(color: AppColors.bearish)),
      onTap: () async {
        await ref.read(authServiceProvider).logout();
        if (context.mounted) context.go('/login');
      },
    );
  }
}
