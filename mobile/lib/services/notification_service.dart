import 'dart:async';
import 'dart:io';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import '../core/network/api_client.dart';

/// Handles push notifications (Firebase Cloud Messaging) for buy/sell alerts,
/// plus local notification display while the app is foregrounded.
class NotificationService {
  NotificationService({ApiClient? api}) : _api = api;

  final ApiClient? _api;
  final _localPlugin = FlutterLocalNotificationsPlugin();
  bool _initialized = false;

  Future<void> init() async {
    if (_initialized) return;
    const androidInit = AndroidInitializationSettings('@mipmap/ic_launcher');
    const initSettings = InitializationSettings(android: androidInit);
    await _localPlugin.initialize(initSettings);

    const tradeChannel = AndroidNotificationChannel(
      'athena_trades',
      'Trade Alerts',
      description: 'Athena buy and sell notifications',
      importance: Importance.high,
    );
    await _localPlugin
        .resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>()
        ?.createNotificationChannel(tradeChannel);

    final messaging = FirebaseMessaging.instance;
    await messaging.requestPermission(alert: true, badge: true, sound: true);

    FirebaseMessaging.onMessage.listen((message) {
      final notification = message.notification;
      if (notification != null) {
        _showLocal(notification.title ?? 'ATHENA', notification.body ?? '');
      }
    });

    messaging.onTokenRefresh.listen((token) {
      final api = _api;
      if (api == null) return;
      unawaited(api.dio.post('/api/devices/fcm', data: {
        'token': token,
        'platform': Platform.isIOS ? 'ios' : 'android',
      }).then((_) {}, onError: (_) {}));
    });

    _initialized = true;
  }

  Future<void> registerWithBackend(ApiClient api) async {
    try {
      final token = await FirebaseMessaging.instance.getToken();
      if (token == null || token.isEmpty) return;
      await api.dio.post('/api/devices/fcm', data: {
        'token': token,
        'platform': Platform.isIOS ? 'ios' : 'android',
      });
    } catch (_) {
      // Firebase / network optional — don't block login.
    }
  }

  Future<void> _showLocal(String title, String body) async {
    const androidDetails = AndroidNotificationDetails(
      'athena_trades',
      'Trade Alerts',
      channelDescription: 'Athena buy and sell notifications',
      importance: Importance.high,
      priority: Priority.high,
    );
    const details = NotificationDetails(android: androidDetails);
    await _localPlugin.show(
      DateTime.now().millisecondsSinceEpoch ~/ 1000,
      title,
      body,
      details,
    );
  }

  Future<String?> getFcmToken() => FirebaseMessaging.instance.getToken();
}
