import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../core/network/api_client.dart';
import '../core/storage/secure_storage_service.dart';
import '../services/auth_service.dart';
import '../services/signal_service.dart';
import '../services/live_signal_service.dart';
import '../services/bot_service.dart';
import '../models/signal_model.dart';
import '../models/bot_config.dart';
import '../core/constants/app_constants.dart';

final secureStorageProvider = Provider((ref) => SecureStorageService());

final apiClientProvider = Provider((ref) => ApiClient(ref.watch(secureStorageProvider)));

final authServiceProvider = Provider(
  (ref) => AuthService(ref.watch(apiClientProvider), ref.watch(secureStorageProvider)),
);

final signalServiceProvider = Provider((ref) => SignalService(ref.watch(apiClientProvider)));

final botServiceProvider = Provider((ref) => BotService(ref.watch(apiClientProvider)));

final botConfigProvider = FutureProvider.autoDispose<BotConfig>((ref) async {
  return ref.watch(botServiceProvider).getConfig();
});

final liveSignalServiceProvider = Provider((ref) {
  final service = LiveSignalService()..connect();
  ref.onDispose(service.dispose);
  return service;
});

/// Currently selected symbol/timeframe on the Dashboard & Signal Details screens.
final selectedSymbolProvider = StateProvider<String>((ref) => AppConstants.supportedSymbols.first);
final selectedTimeframeProvider = StateProvider<String>((ref) => '15m');

/// Fetches the latest REST signal for the current selection.
final latestSignalProvider = FutureProvider.autoDispose<Signal>((ref) async {
  final symbol = ref.watch(selectedSymbolProvider);
  final timeframe = ref.watch(selectedTimeframeProvider);
  final service = ref.watch(signalServiceProvider);
  return service.getLatestSignal(symbol, timeframe);
});

/// Live-streamed signal updates (pushed every ~30s from the backend relay).
final liveSignalStreamProvider = StreamProvider.autoDispose<Signal>((ref) {
  final live = ref.watch(liveSignalServiceProvider);
  return live.signals;
});

final marketPricesProvider = FutureProvider.autoDispose<Map<String, double>>((ref) async {
  final service = ref.watch(signalServiceProvider);
  return service.getMarketPrices();
});

final fearGreedProvider = FutureProvider.autoDispose<Map<String, dynamic>>((ref) async {
  final service = ref.watch(signalServiceProvider);
  return service.getFearGreedIndex();
});

final isLoggedInProvider = FutureProvider<bool>((ref) async {
  final auth = ref.watch(authServiceProvider);
  return auth.isLoggedIn();
});
