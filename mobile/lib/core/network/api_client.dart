import 'dart:async';
import 'package:dio/dio.dart';
import '../constants/app_constants.dart';
import '../storage/secure_storage_service.dart';

class ApiClient {
  final Dio dio;
  final SecureStorageService _storage;
  Completer<bool>? _refreshCompleter;

  ApiClient(this._storage)
      : dio = Dio(BaseOptions(
          baseUrl: AppConstants.apiBaseUrl,
          connectTimeout: const Duration(seconds: 10),
          receiveTimeout: const Duration(seconds: 15),
        )) {
    dio.interceptors.add(InterceptorsWrapper(
      onRequest: (options, handler) async {
        final token = await _storage.getAccessToken();
        if (token != null) {
          options.headers['Authorization'] = 'Bearer $token';
        }
        handler.next(options);
      },
      onError: (error, handler) async {
        if (error.response?.statusCode == 401 &&
            !(error.requestOptions.extra['retried'] == true) &&
            !error.requestOptions.path.contains('/api/auth/')) {
          final refreshed = await _tryRefresh();
          if (refreshed) {
            try {
              final clone = await _retry(error.requestOptions);
              return handler.resolve(clone);
            } catch (e) {
              return handler.next(error);
            }
          }
        }
        handler.next(error);
      },
    ));
  }

  /// Single-flight refresh so parallel 401s don't rotate-and-invalidate each other.
  Future<bool> _tryRefresh() async {
    if (_refreshCompleter != null) {
      return _refreshCompleter!.future;
    }
    final completer = Completer<bool>();
    _refreshCompleter = completer;
    try {
      final refreshToken = await _storage.getRefreshToken();
      if (refreshToken == null) {
        completer.complete(false);
        return false;
      }
      final res = await Dio(BaseOptions(baseUrl: AppConstants.apiBaseUrl)).post(
        '/api/auth/refresh',
        data: {'refreshToken': refreshToken},
      );
      await _storage.saveTokens(
        accessToken: res.data['accessToken'] as String,
        refreshToken: res.data['refreshToken'] as String,
      );
      completer.complete(true);
      return true;
    } catch (_) {
      await _storage.clear();
      completer.complete(false);
      return false;
    } finally {
      _refreshCompleter = null;
    }
  }

  Future<Response> _retry(RequestOptions requestOptions) async {
    final token = await _storage.getAccessToken();
    final headers = Map<String, dynamic>.from(requestOptions.headers);
    if (token != null) {
      headers['Authorization'] = 'Bearer $token';
    } else {
      headers.remove('Authorization');
    }
    return dio.request(
      requestOptions.path,
      data: requestOptions.data,
      queryParameters: requestOptions.queryParameters,
      options: Options(
        method: requestOptions.method,
        headers: headers,
        extra: {...requestOptions.extra, 'retried': true},
      ),
    );
  }
}
