class AppConstants {
  // Overridden at build time via --dart-define=API_BASE_URL=...
  static const apiBaseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'http://10.0.2.2:4000',
  );
  static const wsBaseUrl = String.fromEnvironment(
    'WS_BASE_URL',
    defaultValue: 'ws://10.0.2.2:4000',
  );

  static const supportedSymbols = ['BTC', 'ETH', 'SOL'];
  static const timeframes = ['1m', '5m', '15m', '1h', '4h'];

  /// Safety constant referenced throughout the UI: ATHENA never places
  /// trades automatically. Every screen that shows a signal must make
  /// this explicit to the user.
  static const manualExecutionDisclaimer =
      'ATHENA only generates recommendations. All order execution is manual.';
}
