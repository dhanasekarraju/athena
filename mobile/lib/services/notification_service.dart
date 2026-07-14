import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:firebase_messaging/firebase_messaging.dart';

/// Handles push notifications (Firebase Cloud Messaging) for signal alerts,
/// target-reached alerts, and stop-loss alerts, plus local notification
/// display while the app is foregrounded.
class NotificationService {
  final _localPlugin = FlutterLocalNotificationsPlugin();

  Future<void> init() async {
    const androidInit = AndroidInitializationSettings('@mipmap/ic_launcher');
    const initSettings = InitializationSettings(android: androidInit);
    await _localPlugin.initialize(initSettings);

    final messaging = FirebaseMessaging.instance;
    await messaging.requestPermission(alert: true, badge: true, sound: true);

    FirebaseMessaging.onMessage.listen((message) {
      final notification = message.notification;
      if (notification != null) {
        _showLocal(notification.title ?? 'ATHENA', notification.body ?? '');
      }
    });
  }

  Future<void> _showLocal(String title, String body) async {
    const androidDetails = AndroidNotificationDetails(
      'athena_signals',
      'Signal Alerts',
      channelDescription: 'BUY CALL / BUY PUT signal, target and stop-loss alerts',
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
