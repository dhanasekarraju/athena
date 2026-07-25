import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../core/theme/app_theme.dart';

class RootShell extends StatelessWidget {
  final Widget child;
  final String location;
  const RootShell({super.key, required this.child, required this.location});

  static const _tabs = [
    ('/dashboard', Icons.home_outlined, Icons.home, 'Home'),
    ('/live-log', Icons.menu_book_outlined, Icons.menu_book, 'Live'),
    ('/coraiser', Icons.forum_outlined, Icons.forum, 'Coach'),
    ('/portfolio', Icons.account_balance_outlined, Icons.account_balance, 'Book'),
    ('/settings', Icons.tune_outlined, Icons.tune, 'Settings'),
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
      bottomNavigationBar: Container(
        decoration: const BoxDecoration(
          border: Border(top: BorderSide(color: AppColors.border)),
          color: AppColors.surface,
        ),
        child: BottomNavigationBar(
          currentIndex: currentIndex,
          onTap: (i) => context.go(_tabs[i].$1),
          items: _tabs
              .map((t) => BottomNavigationBarItem(
                    icon: Icon(t.$2),
                    activeIcon: Icon(t.$3, color: AppColors.ink),
                    label: t.$4,
                  ))
              .toList(),
        ),
      ),
    );
  }
}
