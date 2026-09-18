/// Abstract contract for AI interaction services.
/// Decouples the presentation & repository layers from direct Gemini SDK calls,
/// enabling seamless switching between local development fallback and remote Backend API.
abstract class AiRemoteService {
  /// Generates a response based on conversational history.
  Future<String> generateTextResponse(String history);

  /// Generates a multimodal response based on history and a local image path.
  Future<String> generateImageResponse(String history, String imagePath);
}
