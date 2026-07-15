import 'package:go_router/go_router.dart';
import 'features/splash/splash_screen.dart';
import 'features/auth/login_screen.dart';
import 'features/auth/register_screen.dart';
import 'features/dashboard/dashboard_screen.dart';
import 'features/charts/charts_screen.dart';
import 'features/news/news_screen.dart';
import 'features/portfolio/portfolio_screen.dart';
import 'features/journal/journal_screen.dart';
import 'features/live_log/live_log_screen.dart';
import 'features/settings/settings_screen.dart';
import 'features/signals/signal_details_screen.dart';
import 'shared/widgets/root_shell.dart';

final appRouter = GoRouter(
  initialLocation: '/',
  routes: [
    GoRoute(path: '/', builder: (context, state) => const SplashScreen()),
    GoRoute(path: '/login', builder: (context, state) => const LoginScreen()),
    GoRoute(path: '/register', builder: (context, state) => const RegisterScreen()),
    GoRoute(
      path: '/signal-details',
      builder: (context, state) => const SignalDetailsScreen(),
    ),
    ShellRoute(
      builder: (context, state, child) => RootShell(location: state.uri.path, child: child),
      routes: [
        GoRoute(path: '/dashboard', builder: (context, state) => const DashboardScreen()),
        GoRoute(path: '/charts', builder: (context, state) => const ChartsScreen()),
        GoRoute(path: '/live-log', builder: (context, state) => const LiveLogScreen()),
        GoRoute(path: '/news', builder: (context, state) => const NewsScreen()),
        GoRoute(path: '/portfolio', builder: (context, state) => const PortfolioScreen()),
        GoRoute(path: '/journal', builder: (context, state) => const JournalScreen()),
        GoRoute(path: '/settings', builder: (context, state) => const SettingsScreen()),
      ],
    ),
  ],
);
