import 'package:dio/dio.dart';
import '../constants/app_constants.dart';
import '../storage/secure_storage_service.dart';

class ApiClient {
  final Dio dio;
  final SecureStorageService _storage;

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
        if (error.response?.statusCode == 401) {
          final refreshed = await _tryRefresh();
          if (refreshed) {
            final clone = await _retry(error.requestOptions);
            return handler.resolve(clone);
          }
        }
        handler.next(error);
      },
    ));
  }

  Future<bool> _tryRefresh() async {
    final refreshToken = await _storage.getRefreshToken();
    if (refreshToken == null) return false;
    try {
      final res = await Dio(BaseOptions(baseUrl: AppConstants.apiBaseUrl)).post(
        '/api/auth/refresh',
        data: {'refreshToken': refreshToken},
      );
      await _storage.saveTokens(
        accessToken: res.data['accessToken'],
        refreshToken: res.data['refreshToken'],
      );
      return true;
    } catch (_) {
      await _storage.clear();
      return false;
    }
  }

  Future<Response> _retry(RequestOptions requestOptions) {
    final options = Options(method: requestOptions.method, headers: requestOptions.headers);
    return dio.request(
      requestOptions.path,
      data: requestOptions.data,
      queryParameters: requestOptions.queryParameters,
      options: options,
    );
  }
}
