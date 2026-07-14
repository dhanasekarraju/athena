import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:firebase_core/firebase_core.dart';
import 'app_router.dart';
import 'core/theme/app_theme.dart';
import 'services/notification_service.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // Firebase is optional at first run — guard so local dev without
  // google-services.json / GoogleService-Info.plist doesn't crash.
  try {
    await Firebase.initializeApp();
    await NotificationService().init();
  } catch (_) {
    // Push notifications disabled until Firebase config files are added.
  }

  runApp(const ProviderScope(child: AthenaApp()));
}

class AthenaApp extends StatelessWidget {
  const AthenaApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp.router(
      title: 'ATHENA',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.dark(),
      darkTheme: AppTheme.dark(),
      themeMode: ThemeMode.dark,
      routerConfig: appRouter,
    );
  }
}
