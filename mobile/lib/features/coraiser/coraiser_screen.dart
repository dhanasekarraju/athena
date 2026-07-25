import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/theme/app_theme.dart';
import '../../core/providers.dart';
import '../../services/coraiser_service.dart';

class CoraiserScreen extends ConsumerStatefulWidget {
  const CoraiserScreen({super.key});

  @override
  ConsumerState<CoraiserScreen> createState() => _CoraiserScreenState();
}

class _CoraiserScreenState extends ConsumerState<CoraiserScreen> {
  final _controller = TextEditingController();
  final _scroll = ScrollController();
  List<CoraiserMessage> _messages = [];
  bool _loading = true;
  bool _sending = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _controller.dispose();
    _scroll.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final msgs = await ref.read(coraiserServiceProvider).history();
      if (!mounted) return;
      setState(() {
        _messages = msgs;
        _loading = false;
        _error = null;
      });
      _jumpBottom();
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = 'Could not load chat.';
      });
    }
  }

  void _jumpBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!_scroll.hasClients) return;
      _scroll.animateTo(
        _scroll.position.maxScrollExtent + 80,
        duration: const Duration(milliseconds: 250),
        curve: Curves.easeOut,
      );
    });
  }

  Future<void> _send() async {
    final text = _controller.text.trim();
    if (text.isEmpty || _sending) return;
    setState(() {
      _sending = true;
      _messages = [..._messages, CoraiserMessage(role: 'user', content: text)];
      _controller.clear();
      _error = null;
    });
    _jumpBottom();
    try {
      final result = await ref.read(coraiserServiceProvider).chat(text);
      if (!mounted) return;
      setState(() {
        _messages = result.messages;
        _sending = false;
      });
      _jumpBottom();
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _sending = false;
        _error = 'Co-raiser could not reply. Try again.';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(
        title: Text('Co-raiser', style: theme.textTheme.titleLarge?.copyWith(
          fontFamily: AppTypography.displayFamily,
          fontWeight: FontWeight.w600,
        )),
        actions: [
          IconButton(
            tooltip: 'Clear chat',
            onPressed: () async {
              await ref.read(coraiserServiceProvider).clearHistory();
              if (!mounted) return;
              setState(() => _messages = []);
            },
            icon: const Icon(Icons.delete_outline),
          ),
        ],
      ),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 4, 20, 8),
            child: Text(
              'I know her open book and how she trades. Ask about buys, sells, or whether to change her.',
              style: theme.textTheme.bodySmall?.copyWith(color: AppColors.textSecondary),
            ),
          ),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 20),
              child: Text(_error!, style: const TextStyle(color: AppColors.bearish, fontSize: 13)),
            ),
          Expanded(
            child: _loading
                ? const Center(child: CircularProgressIndicator())
                : _messages.isEmpty
                    ? Center(
                        child: Padding(
                          padding: const EdgeInsets.all(32),
                          child: Text(
                            'Say hello — ask what she is holding, or whether that last exit was healthy.',
                            textAlign: TextAlign.center,
                            style: theme.textTheme.bodyMedium?.copyWith(color: AppColors.textSecondary),
                          ),
                        ),
                      )
                    : ListView.builder(
                        controller: _scroll,
                        padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
                        itemCount: _messages.length + (_sending ? 1 : 0),
                        itemBuilder: (context, i) {
                          if (_sending && i == _messages.length) {
                            return const Align(
                              alignment: Alignment.centerLeft,
                              child: Padding(
                                padding: EdgeInsets.symmetric(vertical: 8),
                                child: Text('…', style: TextStyle(color: AppColors.textSecondary)),
                              ),
                            );
                          }
                          final m = _messages[i];
                          final mine = m.role == 'user';
                          return Align(
                            alignment: mine ? Alignment.centerRight : Alignment.centerLeft,
                            child: Container(
                              margin: const EdgeInsets.symmetric(vertical: 5),
                              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                              constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.82),
                              decoration: BoxDecoration(
                                color: mine ? AppColors.ink : AppColors.surface,
                                borderRadius: BorderRadius.circular(4),
                                border: Border.all(color: AppColors.border),
                              ),
                              child: Text(
                                m.content,
                                style: TextStyle(
                                  color: mine ? AppColors.paper : AppColors.textPrimary,
                                  height: 1.4,
                                  fontSize: 15,
                                ),
                              ),
                            ),
                          );
                        },
                      ),
          ),
          SafeArea(
            top: false,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(12, 8, 12, 12),
              child: Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: _controller,
                      minLines: 1,
                      maxLines: 4,
                      textInputAction: TextInputAction.send,
                      onSubmitted: (_) => _send(),
                      decoration: const InputDecoration(hintText: 'Ask about Athena…'),
                    ),
                  ),
                  const SizedBox(width: 8),
                  IconButton.filled(
                    onPressed: _sending ? null : _send,
                    style: IconButton.styleFrom(
                      backgroundColor: AppColors.ink,
                      foregroundColor: AppColors.paper,
                    ),
                    icon: const Icon(Icons.arrow_upward),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
