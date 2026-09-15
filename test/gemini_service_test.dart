import 'package:flutter_test/flutter_test.dart';
import 'package:google_generative_ai/google_generative_ai.dart';
import 'package:craft_app/features/home/data/services/gemini_service.dart';

void main() {
  group('GeminiService.isQuotaOrRateLimit', () {
    test('detects quota and rate-limit errors', () {
      expect(
        GeminiService.isQuotaOrRateLimit(
          ServerException('Resource has been exhausted (e.g. check quota).'),
        ),
        isTrue,
      );
      expect(
        GeminiService.isQuotaOrRateLimit(
          GenerativeAIException('429 Too Many Requests'),
        ),
        isTrue,
      );
      expect(
        GeminiService.isQuotaOrRateLimit(Exception('rate limit exceeded')),
        isTrue,
      );
    });

    test('ignores unrelated errors', () {
      expect(
        GeminiService.isQuotaOrRateLimit(
          Exception('API key not configured. Check .env file.'),
        ),
        isFalse,
      );
      expect(
        GeminiService.isQuotaOrRateLimit(
          Exception('Empty response received from AI.'),
        ),
        isFalse,
      );
    });
  });
}
