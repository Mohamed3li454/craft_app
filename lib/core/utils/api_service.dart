import 'package:dio/dio.dart';

class ApiService {
  final Dio _dio;

  ApiService(this._dio);

  Future<Map<String, dynamic>> getData({
    required String endPoint,
    Map<String, dynamic>? queryParameters,
    String? token,
  }) async {
    final response = await _dio.get(
      endPoint,
      queryParameters: queryParameters,
      options: Options(
        headers: token != null ? {'Authorization': 'Bearer $token'} : null,
      ),
    );
    return response.data as Map<String, dynamic>;
  }

  Future<Map<String, dynamic>> postData({
    required String endPoint,
    required dynamic data,
    Map<String, dynamic>? queryParameters,
    String? token,
  }) async {
    final response = await _dio.post(
      endPoint,
      data: data,
      queryParameters: queryParameters,
      options: Options(
        headers: token != null ? {'Authorization': 'Bearer $token'} : null,
      ),
    );
    return response.data as Map<String, dynamic>;
  }
}
