import '../core/network/api_client.dart';
import '../models/bot_config.dart';
import '../models/bot_live_log.dart';

class BotService {
  final ApiClient _api;
  BotService(this._api);

  Future<BotConfig> getConfig() async {
    final res = await _api.dio.get('/api/bot/config');
    return BotConfig.fromJson(Map<String, dynamic>.from(res.data as Map));
  }

  Future<BotConfig> updateConfig(BotConfig config) async {
    final res = await _api.dio.patch('/api/bot/config', data: config.toPatch());
    return BotConfig.fromJson(Map<String, dynamic>.from(res.data as Map));
  }

  Future<BotLiveLog> getLiveLog({int limit = 80}) async {
    final res = await _api.dio.get('/api/bot/log', queryParameters: {'limit': limit});
    return BotLiveLog.fromJson(Map<String, dynamic>.from(res.data as Map));
  }

  Future<void> kill() async {
    await _api.dio.post('/api/bot/kill');
  }

  Future<void> resume() async {
    await _api.dio.post('/api/bot/resume');
  }
}
