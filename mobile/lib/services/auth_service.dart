import '../core/network/api_client.dart';
import '../core/storage/secure_storage_service.dart';
import '../models/trade_model.dart';

class AuthService {
  final ApiClient _api;
  final SecureStorageService _storage;
  AuthService(this._api, this._storage);

  Future<AthenaUser> login(String email, String password) async {
    final res = await _api.dio.post('/api/auth/login', data: {
      'email': email,
      'password': password,
    });
    await _storage.saveTokens(
      accessToken: res.data['accessToken'],
      refreshToken: res.data['refreshToken'],
    );
    return AthenaUser.fromJson(res.data['user']);
  }

  Future<AthenaUser> register(String email, String password) async {
    final res = await _api.dio.post('/api/auth/register', data: {
      'email': email,
      'password': password,
    });
    await _storage.saveTokens(
      accessToken: res.data['accessToken'],
      refreshToken: res.data['refreshToken'],
    );
    return AthenaUser.fromJson(res.data['user']);
  }

  Future<void> logout() async {
    final refreshToken = await _storage.getRefreshToken();
    try {
      await _api.dio.post('/api/auth/logout', data: {'refreshToken': refreshToken});
    } catch (_) {
      // best-effort; clear local tokens regardless
    }
    await _storage.clear();
  }

  Future<bool> isLoggedIn() async => (await _storage.getAccessToken()) != null;
}
