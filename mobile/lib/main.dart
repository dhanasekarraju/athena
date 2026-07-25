import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:firebase_core/firebase_core.dart';
import 'app_router.dart';
import 'core/theme/app_theme.dart';
import 'core/providers.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // Firebase is optional at first run — guard so local dev without
  // google-services.json / GoogleService-Info.plist doesn't crash.
  try {
    await Firebase.initializeApp();
  } catch (_) {
    // Push notifications disabled until Firebase config files are added.
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
    return MaterialApp.router(
      title: 'ATHENA',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.light(),
      themeMode: ThemeMode.light,
      routerConfig: appRouter,
    );
  }
}
