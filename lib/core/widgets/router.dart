import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:craft_app/core/utils/app_routes.dart';
import 'package:craft_app/core/widgets/page_transitions.dart';
import 'package:craft_app/features/home/presentation/view/bot_view.dart';
import 'package:craft_app/features/home/presentation/view/home_view.dart';
import 'package:craft_app/features/splash/presentation/view/splash_view.dart';

/// Centralized GoRouter navigation table with custom transitions.
abstract class AppRouter {
  AppRouter._();

  static final GoRouter router = GoRouter(
    initialLocation: AppRoutes.splash,
    errorBuilder: (context, state) => const Scaffold(
      body: Center(child: Text('Page not found')),
    ),
    routes: [
      GoRoute(
        path: AppRoutes.splash,
        pageBuilder: (context, state) => fadeSlidePage(
          key: state.pageKey,
          child: const SplashView(),
        ),
      ),
      GoRoute(
        path: AppRoutes.home,
        pageBuilder: (context, state) => fadeSlidePage(
          key: state.pageKey,
          child: const HomeView(),
        ),
      ),
      GoRoute(
        path: AppRoutes.bot,
        pageBuilder: (context, state) {
          final suggestion = state.extra as String? ?? '';
          return fadeSlidePage(
            key: state.pageKey,
            child: BotView(suggestiontext: suggestion),
          );
        },
      ),
    ],
  );
}
