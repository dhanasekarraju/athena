import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:firebase_core/firebase_core.dart';
import 'app_router.dart';
import 'core/theme/app_theme.dart';
import 'core/theme/theme_mode_provider.dart';
import 'core/providers.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  try {
    await Firebase.initializeApp();
  } catch (_) {
    // Push optional until Firebase config exists.
  }

  runApp(const ProviderScope(child: AthenaApp()));
}

class AthenaApp extends ConsumerStatefulWidget {
  const AthenaApp({super.key});

  @override
  ConsumerState<AthenaApp> createState() => _AthenaAppState();
}

class _AthenaAppState extends ConsumerState<AthenaApp> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) async {
      try {
        final notif = ref.read(notificationServiceProvider);
        await notif.init();
        final loggedIn = await ref.read(authServiceProvider).isLoggedIn();
        if (loggedIn) {
          await notif.registerWithBackend(ref.read(apiClientProvider));
        }
      } catch (_) {}
    });
  }

  @override
  Widget build(BuildContext context) {
    final themeMode = ref.watch(themeModeProvider);

    return MaterialApp.router(
      title: 'ATHENA',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.light(),
      darkTheme: AppTheme.dark(),
      themeMode: themeMode,
      builder: (context, child) {
        AppColors.bind(Theme.of(context).brightness);
        return child ?? const SizedBox.shrink();
      },
      routerConfig: appRouter,
    );
  }
}
