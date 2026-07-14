import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../core/theme/app_theme.dart';
import '../../core/providers.dart';

class SplashScreen extends ConsumerStatefulWidget {
  const SplashScreen({super.key});

  @override
  ConsumerState<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends ConsumerState<SplashScreen> {
  @override
  void initState() {
    super.initState();
    Future.delayed(const Duration(milliseconds: 1200), _route);
  }

  Future<void> _route() async {
    final loggedIn = await ref.read(authServiceProvider).isLoggedIn();
    if (!mounted) return;
    context.go(loggedIn ? '/dashboard' : '/login');
  }

  @override
  Widget build(BuildContext context) {
    return const Scaffold(
      backgroundColor: AppColors.background,
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.auto_graph_rounded, size: 72, color: AppColors.primary),
            SizedBox(height: 16),
            Text('ATHENA',
                style: TextStyle(fontSize: 28, fontWeight: FontWeight.w800, letterSpacing: 4)),
            SizedBox(height: 6),
            Text('AI Crypto Signal Intelligence',
                style: TextStyle(color: AppColors.textSecondary, fontSize: 13)),
          ],
        ),
      ),
    );
  }
}
