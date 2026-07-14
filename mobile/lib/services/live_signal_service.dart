import 'dart:async';
import 'dart:convert';
import 'package:web_socket_channel/web_socket_channel.dart';
import '../core/constants/app_constants.dart';
import '../models/signal_model.dart';

class LiveSignalService {
  WebSocketChannel? _channel;
  final _controller = StreamController<Signal>.broadcast();

  Stream<Signal> get signals => _controller.stream;

  void connect() {
    _channel = WebSocketChannel.connect(Uri.parse('${AppConstants.wsBaseUrl}/ws/live'));
    _channel!.stream.listen(
      (raw) {
        try {
          final decoded = jsonDecode(raw as String);
          if (decoded['type'] == 'signal' && decoded['data'] != null) {
            _controller.add(Signal.fromJson(decoded['data']));
          }
        } catch (_) {
          // ignore malformed frames
        }
      },
      onError: (_) {},
      onDone: () {},
    );
  }

  void requestSignal(String symbol, String timeframe) {
    _channel?.sink.add(jsonEncode({'symbol': symbol, 'timeframe': timeframe}));
  }

  void dispose() {
    _channel?.sink.close();
    _controller.close();
  }
}
