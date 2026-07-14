import '../core/network/api_client.dart';
import '../models/signal_model.dart';

class SignalService {
  final ApiClient _api;
  SignalService(this._api);

  Future<Signal> getLatestSignal(String symbol, String timeframe) async {
    final res = await _api.dio.get('/api/signals/latest', queryParameters: {
      'symbol': symbol,
      'timeframe': timeframe,
    });
    return Signal.fromJson(res.data);
  }

  Future<Map<String, double>> getMarketPrices() async {
    final res = await _api.dio.get('/api/market/prices');
    final prices = Map<String, dynamic>.from(res.data['prices'] as Map);
    return prices.map((k, v) => MapEntry(k, (v as num).toDouble()));
  }

  Future<Map<String, dynamic>> getFearGreedIndex() async {
    final res = await _api.dio.get('/api/fear-greed');
    return Map<String, dynamic>.from(res.data);
  }

  Future<List<Map<String, dynamic>>> getNews({int limit = 30}) async {
    final res = await _api.dio.get('/api/news', queryParameters: {'limit': limit});
    return List<Map<String, dynamic>>.from(res.data['news']);
  }
}
