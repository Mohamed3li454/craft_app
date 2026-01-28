import 'package:dio/dio.dart';
import 'package:equatable/equatable.dart';

/// Base failure class extending Equatable for value comparison.
abstract class Failure extends Equatable {
  final String errMessage;
  const Failure(this.errMessage);

  @override
  List<Object?> get props => [errMessage];
}

/// Server & network related failures with Dio error mapping.
class ServerFailure extends Failure {
  const ServerFailure(super.errMessage);

  factory ServerFailure.fromDioError(DioException dioException) {
    switch (dioException.type) {
      case DioExceptionType.connectionTimeout:
      case DioExceptionType.sendTimeout:
      case DioExceptionType.receiveTimeout:
        return const ServerFailure('Connection timeout. Please try again.');
      case DioExceptionType.badResponse:
        return ServerFailure.fromResponse(
          dioException.response?.statusCode,
          dioException.response?.data,
        );
      case DioExceptionType.connectionError:
        return const ServerFailure('No internet connection. Please check your network.');
      case DioExceptionType.cancel:
        return const ServerFailure('Request was canceled.');
      default:
        return const ServerFailure('Unexpected network error. Please try again.');
    }
  }

  factory ServerFailure.fromResponse(int? statusCode, dynamic response) {
    if (statusCode == 400 || statusCode == 401 || statusCode == 403) {
      if (response is Map && response['message'] != null) {
        return ServerFailure(response['message'].toString());
      }
      return const ServerFailure('Authentication or request error.');
    } else if (statusCode == 404) {
      return const ServerFailure('Requested resource not found.');
    } else if (statusCode == 429) {
      return const ServerFailure('Too many requests. Please try again later.');
    } else if (statusCode == 500 || statusCode == 502 || statusCode == 503) {
      return const ServerFailure('Server error. Please try again later.');
    }
    return const ServerFailure('An unexpected error occurred. Please try again.');
  }
}

/// Cache & local database related failures.
class CacheFailure extends Failure {
  const CacheFailure([super.errMessage = 'Failed to load local offline data.']);
}

/// Data parsing / serialization related failures.
class FormatFailure extends Failure {
  const FormatFailure([super.errMessage = 'Unable to process response data.']);
}
