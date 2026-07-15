import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../core/theme/app_theme.dart';

class RootShell extends StatelessWidget {
  final Widget child;
  final String location;
  const RootShell({super.key, required this.child, required this.location});

  static const _tabs = [
    ('/dashboard', Icons.dashboard_outlined, Icons.dashboard, 'Home'),
    ('/charts', Icons.show_chart, Icons.show_chart, 'Charts'),
    ('/live-log', Icons.history_outlined, Icons.history, 'Live Log'),
    ('/news', Icons.newspaper_outlined, Icons.newspaper, 'News'),
    ('/portfolio', Icons.pie_chart_outline, Icons.pie_chart, 'Portfolio'),
    ('/settings', Icons.settings_outlined, Icons.settings, 'Settings'),
  ];

  int _currentIndex() {
    final index = _tabs.indexWhere((t) => location.startsWith(t.$1));
    return index == -1 ? 0 : index;
  }

  @override
  Widget build(BuildContext context) {
    final currentIndex = _currentIndex();
    return Scaffold(
      body: child,
      bottomNavigationBar: BottomNavigationBar(
        currentIndex: currentIndex,
        onTap: (i) => context.go(_tabs[i].$1),
        items: _tabs
            .map((t) => BottomNavigationBarItem(
                  icon: Icon(t.$2),
                  activeIcon: Icon(t.$3, color: AppColors.primary),
                  label: t.$4,
                ))
            .toList(),
      ),
    );
  }
}
