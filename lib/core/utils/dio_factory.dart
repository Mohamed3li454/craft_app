import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';

class DioFactory {
  DioFactory._();

  static final Dio _dio = Dio(
    BaseOptions(
      connectTimeout: const Duration(seconds: 12),
      sendTimeout: const Duration(seconds: 12),
      receiveTimeout: const Duration(seconds: 15),
      headers: {'Accept': 'application/json'},
    ),
  )..interceptors.addAll([
      if (kDebugMode)
        LogInterceptor(
          requestBody: false,
          responseBody: false,
          error: true,
        ),
    ]);

  static Dio get dio => _dio;
}
