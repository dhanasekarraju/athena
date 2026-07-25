import '../core/network/api_client.dart';

class CoraiserMessage {
  final String role;
  final String content;
  final String? at;

  CoraiserMessage({required this.role, required this.content, this.at});

  factory CoraiserMessage.fromJson(Map<String, dynamic> json) => CoraiserMessage(
        role: json['role'] as String? ?? 'assistant',
        content: json['content'] as String? ?? '',
        at: json['at'] as String?,
      );
}

class CoraiserService {
  final ApiClient _api;
  CoraiserService(this._api);

  Future<List<CoraiserMessage>> history() async {
    final res = await _api.dio.get('/api/coraiser/history');
    final list = (res.data['messages'] as List?) ?? [];
    return list
        .map((e) => CoraiserMessage.fromJson(Map<String, dynamic>.from(e as Map)))
        .toList();
  }

  Future<({String reply, List<CoraiserMessage> messages})> chat(String message) async {
    final res = await _api.dio.post('/api/coraiser/chat', data: {'message': message});
    final data = Map<String, dynamic>.from(res.data as Map);
    final list = (data['messages'] as List?) ?? [];
    return (
      reply: data['reply'] as String? ?? '',
      messages: list
          .map((e) => CoraiserMessage.fromJson(Map<String, dynamic>.from(e as Map)))
          .toList(),
    );
  }

  Future<void> clearHistory() async {
    await _api.dio.delete('/api/coraiser/history');
  }
}
