# Craft App — Comprehensive Project Context & Technical Reference

> **Document Purpose**: This document is the technical reference for the Craft Flutter application. It describes architecture, API contracts, state management, models, persistence, Gemini Generative AI integration, multimodal vision processing, chat session management, and navigation strictly as implemented in the codebase.

---

## Table of Contents

1. [Project Overview & Architecture](#project-overview--architecture)
2. [Bootstrap, DI & Theming](#bootstrap-di--theming)
3. [AI & Networking Layer](#1-ai--networking-layer)
    - [GeminiService & Generative AI Configuration](#geminiservice--generative-ai-configuration)
    - [DioFactory & ApiService Client](#diofactory--apiservice-client)
    - [Network Contracts & Endpoints](#network-contracts--endpoints)
4. [Conversational & Multimodal Architecture](#conversational--multimodal-architecture)
5. [State Management (BotCubit)](#2-state-management-botcubit)
6. [Domain Layer](#3-domain-layer)
    - [HomeRepo Contract](#homerepo-contract)
    - [Failure Hierarchy](#failure-hierarchy)
7. [Data Layer](#4-data-layer)
    - [ChatMessageModel & JSON Serialization](#chatmessagemodel--json-serialization)
    - [HomeRepoImpl Implementation](#homerepoimpl-implementation)
8. [Local Storage (SharedPreferences Session & Archive)](#5-local-storage-sharedpreferences-session--archive)
9. [Routing & Navigation](#6-routing--navigation)
10. [Shared UI, Motion System & Markdown Rendering](#7-shared-ui-motion-system--markdown-rendering)
11. [Continuous Integration, Testing & Platform Configuration](#8-continuous-integration-testing--platform-configuration)

---

## Project Overview & Architecture

- **Application Name**: Craft
- **Package Name / Module**: `craft_app`
- **Language**: Dart (SDK `^3.5.0`)
- **Framework**: Flutter (Material 3)
- **Architecture Pattern**: Feature-First Clean Architecture + Cubit state management + repository interfaces. Business logic is strictly separated from widgets, with no direct network or persistence calls inside view widgets.
- **Android Configuration**:
  - `applicationId` and namespace: `com.example.craft_app`
  - Application label: `Craft`
  - Permissions declared: `android.permission.CAMERA`, `android.permission.READ_EXTERNAL_STORAGE`, `android.permission.WRITE_EXTERNAL_STORAGE`, `android.permission.INTERNET`
  - Legacy storage flag: `android:requestLegacyExternalStorage="true"`
  - Window input mode: `adjustResize` with hardware acceleration enabled
- **Key Runtime Dependencies**:
  - **AI**: `google_generative_ai` (`^0.4.6`)
  - **State Management & Inversion**: `flutter_bloc` (`^9.0.0`), `equatable` (`^2.0.7`)
  - **Networking**: `dio` (`^5.8.0+1`), `connectivity_plus` (`^7.0.0`)
  - **Error Handling**: `dartz` (`^0.10.1`)
  - **Local Persistence**: `shared_preferences` (`^2.3.5`)
  - **Secrets**: `flutter_dotenv` (`^6.0.0`)
  - **Routing**: `go_router` (`^14.8.1`)
  - **Media**: `image_picker` (`^1.1.2`), `permission_handler` (`^12.0.1`)
  - **Markdown & Chat UI**: `flutter_markdown_plus` (`^1.0.2`), `dash_chat_2` (`^0.0.21`)
  - **UI & Motion**: `google_fonts` (`^8.0.0`), `lottie` (`^3.1.3`), `animated_text_kit` (`^4.2.2`), `shimmer` (`^3.0.0`), `awesome_dialog` (`^3.2.1`), `alert_info` (`^0.0.3`)

```
UI (Views / Widgets)
        │
     BotCubit
        │
  HomeRepo Interface  (lib/features/home/data/repos/home_repo.dart)
        │
  HomeRepoImpl  ──────┬──────────────────────────────┐
                      ▼                              ▼
                GeminiService                 ChatLocalService
          (google_generative_ai)            (SharedPreferences)
```

Cubits default to `ServiceLocator` instances while accepting optional constructor injection for unit tests and mocks.

---

## Bootstrap, DI & Theming

### `main.dart`

```dart
Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  try {
    await dotenv.load(fileName: 'assets/.env');
  } catch (_) {
    // Graceful fallback if .env is missing or not provided in assets
  }

  ServiceLocator.init();
  runApp(const MyApp());
}

class MyApp extends StatelessWidget {
  const MyApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp.router(
      routerConfig: AppRouter.router,
      theme: AppTheme.darkTheme,
      debugShowCheckedModeBanner: false,
    );
  }
}
```

The application initializes widget bindings, loads secrets from `assets/.env` via `flutter_dotenv`, registers singletons in `ServiceLocator`, and mounts `MaterialApp.router` with a unified dark theme and `AppRouter.router`.

### ServiceLocator — `lib/core/di/service_locator.dart`

```dart
class ServiceLocator {
  ServiceLocator._();

  static late final ApiService apiService;
  static late final ChatLocalService chatLocalService;
  static late final GeminiService geminiService;
  static late final HomeRepo homeRepo;

  static void init() {
    apiService = ApiService(DioFactory.dio);
    chatLocalService = ChatLocalService();
    geminiService = GeminiService();
    homeRepo = HomeRepoImpl(
      geminiService: geminiService,
      chatLocalService: chatLocalService,
    );
  }
}
```

### AppColors & AppTheme

- **`lib/constants/app_colors.dart`**: Centralizes brand colors, dark navy tones, dialog tokens, and multi-stop linear gradients. Zero hardcoded colors are permitted in presentation widgets.

| Token | Hex Value | Semantic Usage |
| :--- | :--- | :--- |
| `primaryBlue` | `#0C3D97` | Primary brand accent & top appbar background |
| `darkNavy` | `#0A1833` | Secondary dark background & bottom drawer base |
| `deepDark` | `#0B1222` | Scaffold background & lowest depth layer |
| `accentGreen` | `#2F8D79` | Gradient accent & divider highlight |
| `lightGreen` | `#AEF696` | High-contrast headline text gradient stop |
| `cardBackground` | `#1E1E2C` | Input textfield container background |
| `dialogBackground` | `#1A1A2E` | Confirmation dialog background |
| `warningRed` | `#E94560` | Dialog warning header text |
| `deleteRed` | `#D62828` | Drawer delete action button |
| `suggestionGreen` | `#A5D6A7` | Academic Assistance suggestion card |
| `suggestionBlue` | `#87D7E2` | Health Improvement suggestion card |
| `suggestionOrange` | `#F4A460` | Personal Development suggestion card |

#### Linear Gradients:
- **`primaryGradient`**: `[primaryBlue, darkNavy, deepDark]` (3 stops) — Used in `HomeViewBody`.
- **`extendedGradient`**: `[primaryBlue, primaryBlue, darkNavy, deepDark]` (4 stops) — Used in `BotViewBody` and `CustomDialog`.
- **`splashGradient`**: `[darkNavy, primaryBlue]` (2 stops) — Used in `SplashViewBody`.
- **`accentGradient`**: `[lightGreen, accentGreen]` — Used in `CustomTextWidget` and `GradientAnimatedText` shader masks.

### AppTheme — `lib/core/theme/app_theme.dart`

```dart
abstract class AppTheme {
  AppTheme._();

  static ThemeData get darkTheme => ThemeData(
        useMaterial3: true,
        brightness: Brightness.dark,
        fontFamily: 'Poppins',
        colorScheme: const ColorScheme.dark(
          primary: AppColors.primaryBlue,
          secondary: AppColors.accentGreen,
          surface: AppColors.deepDark,
        ),
        scaffoldBackgroundColor: AppColors.deepDark,
      );
}

extension ThemeHelper on BuildContext {
  ColorScheme get colors => Theme.of(this).colorScheme;
  bool get isDark => Theme.of(this).brightness == Brightness.dark;
  Color get titleColor => colors.onSurface;
  Color get mutedColor => isDark ? AppColors.darkMuted : AppColors.muted;
}
```

---

## 1. AI & Networking Layer

### GeminiService & Generative AI Configuration

**Path**: `lib/features/home/data/services/gemini_service.dart`

Interactions with Google Gemini are managed directly through the official `google_generative_ai` SDK:

```dart
class GeminiService {
  String get _modelName => dotenv.env['GEMINI_MODEL'] ?? 'gemini-3.6-flash';
  String get _fallbackModelName =>
      dotenv.env['GEMINI_FALLBACK_MODEL'] ?? 'gemini-3.1-flash-lite';

  Future<String> _generate(List<Content> content) async {
    try {
      return await _generateWithModel(_modelName, content);
    } catch (error) {
      if (!isQuotaOrRateLimit(error) || _fallbackModelName == _modelName) {
        rethrow;
      }
      return _generateWithModel(_fallbackModelName, content);
    }
  }
}
```

- **Model**: Defaults to `gemini-3.6-flash` with Craft system instructions. Falls back to `gemini-3.1-flash-lite` on quota, rate-limit, or retired-model errors. Configurable via `GEMINI_MODEL` and `GEMINI_FALLBACK_MODEL` in `.env`.
- **Craft Persona**: `systemInstruction` from `CraftPersona.systemInstruction` identifies the assistant as Craft and never as Gemini.
- **Multimodal Payload**: Images read as raw bytes are dynamically identified with their MIME type (JPEG, PNG, WEBP, GIF, HEIC) alongside user text within a `Content.multi([...])` payload.

---

### DioFactory & ApiService Client

#### DioFactory — `lib/core/utils/dio_factory.dart`

```dart
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
```

#### ApiService — `lib/core/utils/api_service.dart`

```dart
class ApiService {
  final Dio _dio;

  ApiService(this._dio);

  Future<Map<String, dynamic>> getData({
    required String endPoint,
    Map<String, dynamic>? queryParameters,
    String? token,
  });

  Future<Map<String, dynamic>> postData({
    required String endPoint,
    required dynamic data,
    Map<String, dynamic>? queryParameters,
    String? token,
  });
}
```

- Provides reusable generic REST methods with token injection and query parameter mapping.
- Interceptors log network errors strictly in `kDebugMode`.

---

## Conversational & Multimodal Architecture

```
User Input (Text or Gallery Photo)
   │
   ├─► User Types Text ───────────────────► sendMessage(text)
   │                                           │
   │                                           ▼
   │                              ChatMessageModel (userId: '1')
   │                                           │
   └─► User Picks Photo ──────────────────► sendImage(path)
                                               │
                                               ▼
                                  ChatMessageModel (with imagePath)
                                               │
                                               ▼
                                 Insert at Index 0 in _messages
                                               │
                                               ▼
                                   Cache to SharedPreferences
                                               │
                                               ▼
                                 Emit BotWaitingForResponse
                                 (Renders Lottie Waiting Asset)
                                               │
                                               ▼
                                 HomeRepo.getBotResponse()
                                               │
                                               ▼
                                 Gemini Generative Model
                                 (gemini-3.6-flash)
                                               │
                                               ▼
                                 Receive AI String Output
                                               │
                                               ▼
                                 Insert Bot ChatMessageModel
                                 (userId: '2', userName: 'Craft')
                                               │
                                               ▼
                                 Emit BotMessageSent(messages)
                                               │
                                               ▼
                                 MessageItem Stream Renderer
                                 (2ms Typewriter + MarkdownBody)
```

### Context Aggregation
The conversation history passed to Gemini is constructed dynamically from inverted active messages:
```dart
String get _chatHistory {
  return _messages.reversed.map((msg) => ' ${msg.text}').join('\n');
}
```
This guarantees that conversational context accumulates naturally as multi-turn dialogue progresses.

---

## 2. State Management (BotCubit)

### BotCubit Lifecycle & Safety Guarantees
- **Path**: `lib/features/home/presentation/manager/bot_cubit/bot_cubit.dart`
- **Part files**: `bot_cubit.dart` and `bot_state.dart`
- **Constructor Injection**: Injects `HomeRepo` with fallback to `ServiceLocator.homeRepo`.
- **Lifecycle Guards**: Every asynchronous operation enforces `if (isClosed) return;` immediately following awaits and before state emissions to prevent memory leaks and unhandled exceptions.

```dart
class BotCubit extends Cubit<BotState> {
  final HomeRepo homeRepo;

  BotCubit({HomeRepo? homeRepo})
      : homeRepo = homeRepo ?? ServiceLocator.homeRepo,
        super(const BotInitial()) {
    loadCachedMessages();
  }

  final List<ChatMessageModel> _messages = [];
  List<ChatMessageModel> get messages => List.unmodifiable(_messages);

  int? currentChatIndex;
  // ... methods: sendMessage, sendImage, startNewChat, clearChatCache, loadOldChat
}
```

### State Hierarchy — `lib/features/home/presentation/manager/bot_cubit/bot_state.dart`

`BotState` extends `Equatable`:

| State Class | Payload | Meaning |
| :--- | :--- | :--- |
| `BotInitial` | None | Cubit initialized, before loading cache |
| `BotLoading` | None | General background loading state |
| `BotWaitingForResponse` | `List<ChatMessageModel> messages` | User message dispatched, waiting for Gemini API response (displays Lottie loader) |
| `BotMessageSent` | `List<ChatMessageModel> messages` | Messages updated successfully (displays message list or welcome text) |
| `BotFailure` | `String errMessage` | Operation failed (displays `CustomErrorWidget` with retry callback) |

### Key Cubit Methods

- **`sendMessage(String userText)`**: Validates non-empty trimmed text, inserts user model, caches messages, emits `BotWaitingForResponse`, queries `homeRepo.getBotResponse(_chatHistory)`, and appends bot response.
- **`sendImage(String imagePath)`**: Inserts image model, caches, emits `BotWaitingForResponse`, queries `homeRepo.getBotResponseWithImage(_chatHistory, imagePath)`, and appends bot response.
- **`startNewChat()`**: Archives current `_messages` to `oldChats` list in SharedPreferences, clears the active message list, clears active cache, and emits `BotMessageSent([])`.
- **`clearChatCache(int? chatIndex)`**: Deletes an archived chat thread if `chatIndex` is provided, clears active messages and cache, and resets UI state.
- **`loadOldChat(int index)`**: Safely stashes current active messages to `oldChats`, restores selected archived thread into active `_messages`, removes it from the archive, updates both caches, and refreshes UI.

---

## 3. Domain Layer

### HomeRepo Contract

**Path**: `lib/features/home/data/repos/home_repo.dart`

```dart
abstract class HomeRepo {
  Future<Either<Failure, String>> getBotResponse(String history);
  Future<Either<Failure, String>> getBotResponseWithImage(String history, String imagePath);
  Future<Either<Failure, List<ChatMessageModel>>> loadCachedMessages();
  Future<Either<Failure, void>> cacheMessages(List<ChatMessageModel> messages);
  Future<Either<Failure, List<List<ChatMessageModel>>>> getOldChats();
  Future<Either<Failure, void>> saveOldChats(List<List<ChatMessageModel>> oldChats);
  Future<Either<Failure, void>> clearCurrentChat();
}
```

All methods declare functional intent and return `Either<Failure, T>` using `dartz`.

---

### Failure Hierarchy — `lib/core/errors/failure.dart`

`Failure` extends `Equatable` (`props => [errMessage]`).

- **`ServerFailure`**:
  - `fromDioError(DioException)`: Maps timeouts, `badResponse`, `connectionError` (offline), and cancellation.
  - `fromResponse(int? statusCode, dynamic response)`: Handles HTTP 400, 401, 403, 404, 429 (Rate Limit), 500, 502, 503.
  - String sanitization: Safely strips `Exception: ` prefixes from Gemini SDK runtime exceptions.
- **`CacheFailure`**: Default `'Failed to load local offline data.'`.
- **`FormatFailure`**: Default `'Unable to process response data.'`.

---

## 4. Data Layer

### ChatMessageModel & JSON Serialization

**Path**: `lib/features/home/data/models/chat_message_model.dart`

Extends `Equatable`. Represents a single conversation exchange with bidirectional compatibility for `dash_chat_2`.

```dart
class ChatMessageModel extends Equatable {
  final String userId;
  final String userName;
  final String text;
  final DateTime createdAt;
  final String? imagePath;

  const ChatMessageModel({
    required this.userId,
    required this.userName,
    required this.text,
    required this.createdAt,
    this.imagePath,
  });

  bool get isBot => userId == '2';
  // ... fromJson, toJson, toChatMessage, fromChatMessage, copyWith
}
```

- **Defensive Parsing**: Handles both raw `userId` / `userName` and nested `user: {id, firstName}` objects.
- **Timestamp Robustness**: Parses integer epoch milliseconds or ISO-8601 strings, falling back to `DateTime.now()`.
- **Multimodal Property**: Maps image paths to `customProperties: {'image': path}` for DashChat UI compatibility.
- **Props**: `[userId, userName, text, createdAt, imagePath]`.

---

### HomeRepoImpl Implementation

**Path**: `lib/features/home/data/repos/home_repo_impl.dart`

Coordinates `GeminiService` and `ChatLocalService`:

```dart
class HomeRepoImpl implements HomeRepo {
  final GeminiService geminiService;
  final ChatLocalService chatLocalService;

  HomeRepoImpl({
    required this.geminiService,
    required this.chatLocalService,
  });

  @override
  Future<Either<Failure, String>> getBotResponse(String history) async {
    try {
      final response = await geminiService.generateTextResponse(history);
      return right(response);
    } catch (e) {
      if (e is Failure) return left(e);
      if (e is DioException) return left(ServerFailure.fromDioError(e));
      return left(ServerFailure(
        e.toString().split('\n').first.replaceFirst('Exception: ', ''),
      ));
    }
  }

  @override
  Future<Either<Failure, String>> getBotResponseWithImage(
    String history,
    String imagePath,
  ) async {
    try {
      final response = await geminiService.generateImageResponse(history, imagePath);
      return right(response);
    } catch (e) {
      if (e is Failure) return left(e);
      if (e is DioException) return left(ServerFailure.fromDioError(e));
      return left(ServerFailure(
        e.toString().split('\n').first.replaceFirst('Exception: ', ''),
      ));
    }
  }

  // Caching and archiving methods wrapped in try/catch returning CacheFailure on error
}
```

---

## 5. Local Storage (SharedPreferences Session & Archive)

**Service**: `lib/features/home/data/services/chat_local_service.dart`

Persistence is powered by `shared_preferences` without requiring complex SQLite setup:

### Keys:
1. **`current_chat_messages`**: `List<String>` containing JSON-encoded active `ChatMessageModel` items.
2. **`old_chats`**: `List<String>` where each element is a JSON-encoded `List<ChatMessageModel>` array representing an archived thread.

```dart
class ChatLocalService {
  static const String _currentChatKey = 'current_chat_messages';
  static const String _oldChatsKey = 'old_chats';

  Future<void> cacheMessages(List<ChatMessageModel> messages);
  Future<List<ChatMessageModel>> loadCachedMessages();
  Future<List<List<ChatMessageModel>>> getOldChats();
  Future<void> saveOldChats(List<List<ChatMessageModel>> chats);
  Future<void> clearCurrentChat();
}
```

---

## 6. Routing & Navigation

### AppRoutes — `lib/core/utils/app_routes.dart`

```dart
abstract class AppRoutes {
  AppRoutes._();

  static const String splash = '/';
  static const String home = '/home';
  static const String bot = '/bot';
}
```

### GoRouter Configuration — `lib/core/widgets/router.dart`

| Route | Path | View | Arguments / Logic |
| :--- | :--- | :--- | :--- |
| `AppRoutes.splash` | `/` | `SplashView` | Displays splash Lottie animation; auto-navigates to `/home` after 2500ms |
| `AppRoutes.home` | `/home` | `HomeView` | Dashboard with pulsing bot trigger & 3 suggestion cards |
| `AppRoutes.bot` | `/bot` | `BotView` | Chat workspace; accepts optional `extra: String` pre-populating input |

### Custom Route Transitions — `lib/core/widgets/page_transitions.dart`

`fadeSlidePage` wraps route transitions in simultaneous `FadeTransition` and `SlideTransition`:
- Slide: `Tween<Offset>(begin: Offset(0.05, 0), end: Offset.zero)` with `Curves.easeInOutCubic`.
- Transition duration: 500ms.

---

## 7. Shared UI, Motion System & Markdown Rendering

### 1. Progressive Typewriter Animation (`MessageItem`)
Bot responses simulate real-time typing output:
- **Timer Frequency**: 2ms periodic interval (`Timer.periodic`).
- **Sanitization**: `sanitizeText` strips unsupported Unicode characters (`RegExp(r'[^\u0000-\uFFFF]')`).
- **Deduplication**: `Set<String> displayedMessageIds` ensures that previously animated messages re-render statically when scrolling or reloading.

### 2. Markdown Rendering (`flutter_markdown_plus`)
Bot messages are rendered with `MarkdownBody`:
- Selectable text enabled (`selectable: true`).
- Custom stylesheet applying `fontFamily: 'Poppins'`, `fontSizeFactor: 1.2`, and `bodyColor: Colors.white`.

### 3. Interactive Home Button (`CustomAnimatedButton`)
- Pulsing glow created via `AnimationController` (duration: 1s, `repeat(reverse: true)`).
- Animates spread radius and blur radius between `5.0` and `20.0`.
- Hosts Lottie bot asset `Animation - 1729151259606.json`.
- Tap navigates to `AppRoutes.bot`.

### 4. Suggestion System (`SuggestionBox`)
Cards on `HomeView` feature custom box shadows (`Offset(5, 10)`), Google Fonts headers (`Josefin Sans`), and prompt bodies (`Lato`). Tapping calls `context.push(AppRoutes.bot, extra: body)`, immediately loading the prompt into the bot input.

### 5. Drawer & Archive Management (`MenuDrawer`)
Triggered via the hamburger menu on `CustomAppBar`:
- Embedded inside a `DraggableScrollableSheet` (`minChildSize: 0.3`, `maxChildSize: 0.9`).
- **Delete Action**: Triggers an `AwesomeDialog` error modal with confirm/cancel buttons to prevent data loss.
- **New Chat Action**: Commits active thread to archive and cleans the input area.
- **History List**: Renders archived threads with preview subtitles. Tapping an item swaps it into the active workspace.

### 6. Real-Time Connectivity Stream (`BotView` & `CustomDialog`)
- Wrapped in `StreamBuilder<List<ConnectivityResult>>` on `Connectivity().onConnectivityChanged`.
- When `ConnectivityResult.none` is detected, `BotView` replaces the layout with `CustomDialog`.
- `CustomDialog` renders `Animation - 1736357472964.json` with an OK/dismiss action.

---

## 8. Continuous Integration, Testing & Platform Configuration

### Unit Tests — `test/bot_cubit_test.dart`
Full test coverage using a standalone `FakeHomeRepo`:
1. **Initial Cache Load**: Verifies `BotInitial` transitions to `BotMessageSent` with cached data.
2. **Message Flow**: Verifies `sendMessage` appends user message, queries repository, and emits `BotMessageSent` with bot output.
3. **Failure Handling**: Verifies repository failures transition to `BotFailure` containing the error message.
4. **Chat Archiving**: Verifies `startNewChat` commits messages to the archive list and clears active state.

### Widget Smoke Test — `test/widget_test.dart`
Verifies dependency injection and root `MyApp` widget mounting without runtime crashes.

### Android Permissions Summary
- `android.permission.CAMERA`: Multimodal image capture.
- `android.permission.READ_EXTERNAL_STORAGE`: Gallery image selection.
- `android.permission.WRITE_EXTERNAL_STORAGE`: Saving chat media.
- `android.permission.INTERNET`: Gemini API and Dio networking.
- `android:requestLegacyExternalStorage="true"`: Android 10/11 compatibility.
