<div align="center">

# 🤖 Craft

**Next-Gen AI Assistant & Conversational Intelligence Powered by Google Gemini**

A modern, high-performance Flutter application engineered for fluid conversational AI, multimodal vision queries, real-time typewriter response streaming, chat history archiving, and offline resilience. Built with Google Gemini 3.6 Flash, full dark theme aesthetics, and a robust Feature-First Cubit architecture.

[![Flutter](https://img.shields.io/badge/Flutter-3.5+-02569B?style=for-the-badge&logo=flutter&logoColor=white)](https://flutter.dev)
[![Dart](https://img.shields.io/badge/Dart-3.5+-0175C2?style=for-the-badge&logo=dart&logoColor=white)](https://dart.dev)
[![Architecture](https://img.shields.io/badge/Architecture-Feature--First%20%2B%20Cubit-0c3d97?style=for-the-badge)](https://flutter.dev)
[![State Management](https://img.shields.io/badge/State%20Management-Flutter%20Bloc%20%2F%20Cubit-42A5F5?style=for-the-badge&logo=bloc&logoColor=white)](https://bloclibrary.dev)
[![AI Engine](https://img.shields.io/badge/AI%20Engine-Google%20Gemini%203.6-8E75FF?style=for-the-badge&logo=google&logoColor=white)](https://ai.google.dev)
[![Storage](https://img.shields.io/badge/Local%20Storage-SharedPreferences-FF6F00?style=for-the-badge)](https://pub.dev/packages/shared_preferences)
[![License](https://img.shields.io/badge/License-MIT-green.svg?style=for-the-badge)](LICENSE)

---

</div>

## 📖 Table of Contents

- [Overview](#-overview)
- [Key Features](#-key-features)
- [Tech Stack & Architecture](#-tech-stack--architecture)
- [Project Structure](#-project-structure)
- [AI & Conversational Architecture](#-ai--conversational-architecture)
- [Error Handling & Offline Architecture](#-error-handling--offline-architecture)
- [Continuous Integration & Automated Testing](#-continuous-integration--automated-testing)
- [Getting Started / Installation](#-getting-started--installation)
- [Environment Configuration](#-environment-configuration)
- [License](#-license)

---

## 🌟 Overview

**Craft** is an intelligent personal AI assistant mobile application built with Flutter and powered by the **Google Gemini Generative AI SDK**. Designed around an immersive deep-space aesthetic (`#0B1222`, `#0A1833`, `#0C3D97`), Craft provides instant, natural conversations, visual problem-solving, and effortless chat session organization.

Whether you need academic homework assistance, health habits coaching, communication skills guidance, or image analysis, Craft leverages **Gemini 3.6 Flash** for rapid, accurate, and context-aware responses formatted in rich GitHub-flavored Markdown.

### 💡 Core Interaction Experiences:
1. **Interactive Prompt Launchpad**: An animated welcome dashboard featuring glowing pulsing triggers and curated suggestion cards that route directly to pre-populated chat queries.
2. **Real-Time Multimodal Chat Workspace**: Converse with text or snap/attach photos directly from the gallery. Messages stream smoothly with progressive typewriter micro-animations, Markdown parsing, and intelligent chat caching.
3. **Session Archiving & Management Drawer**: Save, reload, and organize past conversation threads seamlessly through a smooth draggable modal bottom sheet.

---

## ✨ Key Features

- **🧠 Google Gemini 3.6 Flash Integration**: Real-time generative AI responses for both text queries and vision queries using the official `google_generative_ai` SDK with full conversational history context. Falls back to Gemini 3.5 Flash-Lite when quota or rate limits are hit.
- **📷 Multimodal Vision Analysis**: Attach images directly from your device gallery via `image_picker`. Gemini processes the image bytes (`DataPart('image/jpeg', bytes)`) alongside prompt context to explain, extract, or solve visual content.
- **⚡ Progressive Typewriter Animation**: Bot responses render through a custom character-by-character typewriter effect (`Timer.periodic` at 2ms) with duplicate message ID tracking (`Set<String> displayedMessageIds`) to avoid re-animating previously loaded historical messages.
- **📝 Rich Markdown & Code Formatting**: Bot messages render using `flutter_markdown_plus` (`MarkdownBody`), supporting bold, headers, lists, code blocks, and selectable text tailored to Poppins typography.
- **📂 Chat History & Thread Archiving**:
  - **Auto-Caching**: Active conversation automatically persists to `SharedPreferences` in JSON format across app restarts.
  - **Thread Archiving**: Starting a "New Chat" archives the existing conversation into an old chats archive list.
  - **Draggable Drawer**: Swipe up the bottom sheet drawer (`menu_drawer.dart`) to inspect previous conversations, read message previews, and restore any previous chat session back into the workspace.
  - **Safe Deletion Modal**: Integrated `AwesomeDialog` confirmation dialog preventing accidental history deletion.
- **📡 Real-Time Connectivity Guard**: Live network monitoring powered by `connectivity_plus`. If disconnected, the bot view gracefully presents a styled `CustomDialog` with a dedicated Lottie offline animation and retry action.
- **🎨 Deep Space Neon Theme**: Handcrafted dark color palette (`AppColors`) featuring multi-stop linear gradients (`primaryGradient`, `extendedGradient`, `splashGradient`, `accentGradient`), shader masks, and custom typography (`Poppins`, `Josefin Sans`, `Lato`, `Orbitron`).
- **✨ Vector Micro-Animations**: High-performance Lottie animations for splash sequence, pulsing bot button, waiting/thinking indicator, and menu drawer items.
- **🛡️ Clean Feature-First Architecture**: Strictly decoupled layers (Presentation → Cubit → Repository Contract → Remote/Local Services) ensuring zero UI business logic, constructor dependency injection, and 100% test mockability.

---

## 🛠️ Tech Stack & Architecture

### **Technology Stack**

| Layer | Technology / Package | Purpose |
| :--- | :--- | :--- |
| **Framework** | Flutter (SDK `^3.5.0`) | Cross-platform UI development (Material 3) |
| **Language** | Dart (`^3.5.0`) | Strongly typed, null-safe application logic |
| **Architecture** | Feature-First Clean Architecture + Cubit | UI → Cubit → Repo Contract → Remote/Local Services |
| **State Management** | `flutter_bloc` & `equatable` | Predictable, reactive state management with value equality |
| **AI Engine** | `google_generative_ai` | Official Google Gemini SDK (`gemini-3.6-flash`, fallback `gemini-3.1-flash-lite`) |
| **Networking & HTTP** | `dio` | Centralized `DioFactory` and `ApiService` for REST endpoints |
| **Local Persistence** | `shared_preferences` | Active chat cache (`current_chat_messages`) & archives (`old_chats`) |
| **Config & Secrets** | `flutter_dotenv` | Secure runtime loading of Gemini API key from `assets/.env` |
| **Navigation & Routes** | `go_router` | Declarative routing with custom `fadeSlidePage` transitions |
| **Media & Hardware** | `image_picker` & `permission_handler` | Camera and photo gallery selection for multimodal queries |
| **Network Monitoring** | `connectivity_plus` | Real-time connectivity change stream listener |
| **Markdown Rendering** | `flutter_markdown_plus` | Selectable markdown rendering for bot output |
| **Typography** | `google_fonts` | Specialized fonts (`Poppins`, `Josefin Sans`, `Lato`, `Orbitron`) |
| **Animations** | `lottie` & `animated_text_kit` | Vector animations and typewriter welcome headline |
| **Functional Error Handling** | `dartz` | `Either<Failure, T>` return pattern for compile-time safety |
| **Chat Schema** | `dash_chat_2` | Compatible chat user and message mapping |
| **Dialogs & Alerts** | `awesome_dialog` & `alert_info` | Animated confirmation modals and info banners |

---

## 📁 Project Structure

```text
lib/
├── constants/
│   └── app_colors.dart                 # Brand palette, dark navy tokens & gradient definitions
├── core/
│   ├── di/
│   │   └── service_locator.dart        # ServiceLocator registry (ApiService, Services, HomeRepo)
│   ├── errors/
│   │   └── failure.dart                # Failure hierarchy (ServerFailure, CacheFailure, FormatFailure)
│   ├── theme/
│   │   └── app_theme.dart              # Dark ThemeData & ThemeHelper BuildContext extension
│   ├── utils/
│   │   ├── api_service.dart            # Dio REST client wrapper (getData, postData)
│   │   ├── app_routes.dart             # Centralized route name constants ('/', '/home', '/bot')
│   │   ├── dio_factory.dart            # Configured Dio instance with timeouts & logging
│   │   └── styles.dart                 # App-wide text style tokens (Orbitron)
│   └── widgets/
│       ├── custom_error_widget.dart    # Theme-aware error placeholder with retry callback
│       ├── page_transitions.dart       # Reusable fadeSlidePage route transition
│       ├── router.dart                 # GoRouter declaration & error route handler
│       └── shimmer_container.dart      # Skeleton loader placeholder
├── features/
│   ├── home/
│   │   ├── data/
│   │   │   ├── models/
│   │   │   │   └── chat_message_model.dart # ChatMessageModel entity & DashChat adapter
│   │   │   ├── repos/
│   │   │   │   ├── home_repo.dart          # HomeRepo abstract interface (Either<Failure, T>)
│   │   │   │   └── home_repo_impl.dart     # HomeRepoImpl orchestrating Gemini & Cache
│   │   │   └── services/
│   │   │       ├── chat_local_service.dart # SharedPreferences session & archive persistence
│   │   │       └── gemini_service.dart     # Google Generative AI integration (text & vision)
│   │   └── presentation/
│   │       ├── manager/
│   │       │   └── bot_cubit/
│   │       │       ├── bot_cubit.dart      # State manager for chat session & history
│   │       │       └── bot_state.dart      # Equatable states (Initial, Waiting, Sent, Failure)
│   │       └── view/
│   │           ├── bot_view.dart           # Bot chat view with Connectivity StreamBuilder
│   │           ├── home_view.dart          # Home dashboard view entry point
│   │           └── widgets/
│   │               ├── bot_view_body.dart  # Bot view layout with AnimatedSwitcher
│   │               ├── custom_animated_button.dart # Pulsing glowing bot button
│   │               ├── custom_appbar.dart  # Custom top bar with Lottie & drawer trigger
│   │               ├── custom_dialog.dart  # Offline modal alert with Lottie
│   │               ├── custom_text_widget.dart     # Welcoming hero gradient text
│   │               ├── gradient_animated_text.dart # Typewriter animated welcome text
│   │               ├── menu_drawer.dart    # Draggable bottom sheet with chat archives & delete
│   │               ├── message_input.dart  # Input text field with image picker & send action
│   │               ├── message_item.dart   # Chat bubble with markdown & typewriter animation
│   │               ├── message_list.dart   # Inverted scrollable message list
│   │               └── suggestion_box.dart # Quick-prompt topic cards
│   └── splash/
│       └── presentation/
│           └── view/
│               ├── splash_view.dart        # Splash screen entry point
│               └── widgets/
│                   └── splash_view_body.dart # Lottie splash animation & 2.5s timer navigation
└── main.dart                               # Flutter binding, .env load, ServiceLocator & MaterialApp.router
```

---

## 🤖 AI & Conversational Architecture

```
                               ┌─────────────────────────┐
                               │   Home / Bot UI View    │
                               └────────────┬────────────┘
                                            │
                       ┌────────────────────┴────────────────────┐
                       ▼                                         ▼
            [ Send Text Message ]                      [ Pick & Send Image ]
                       │                                         │
                       ▼                                         ▼
        ┌─────────────────────────────────────────────────────────────────┐
        │                            BotCubit                             │
        │  • Inserts user message into list & emits BotMessageSent        │
        │  • Saves to cache via ChatLocalService                          │
        │  • Emits BotWaitingForResponse (triggers Lottie bot animation)  │
        └────────────────────────────────┬────────────────────────────────┘
                                         │
                                         ▼
        ┌─────────────────────────────────────────────────────────────────┐
        │                       HomeRepoImpl Contract                     │
        │         • Returns Future<Either<Failure, String>>               │
        └────────────────┬───────────────────────────────┬────────────────┘
                         │                               │
                         ▼                               ▼
        ┌─────────────────────────────────┐   ┌───────────────────────────┐
        │          GeminiService          │   │     ChatLocalService      │
        │   (google_generative_ai SDK)    │   │    (SharedPreferences)    │
        │  • generateTextResponse()       │   │  • cacheMessages()        │
        │  • generateImageResponse()      │   │  • loadCachedMessages()   │
        │  • Model: gemini-3.6-flash      │   │  • getOldChats()          │
        └────────────────┬────────────────┘   │  • saveOldChats()         │
                         │                    └───────────────────────────┘
                         ▼
        ┌─────────────────────────────────────────────────────────────────┐
        │                   AI Response Streaming to UI                   │
        │  • Formats ChatMessageModel(userId: '2', userName: 'Craft')     │
        │  • Renders with MarkdownBody (selectable text & code blocks)    │
        │  • Typewriter animation (2ms incremental periodic stream)       │
        └─────────────────────────────────────────────────────────────────┘
```

---

## 🛡️ Error Handling & Offline Architecture

Craft ensures total fault tolerance and graceful error recovery across network, hardware, and AI processing:

- **Functional Error Pattern (`dartz`)**: All repository operations return `Future<Either<Failure, T>>`, eliminating unhandled runtime crashes and ensuring the Cubit explicitly handles both `left(Failure)` and `right(Success)`.
- **`ServerFailure`**: Maps `DioException` types (connection timeouts, bad responses, connection errors, request cancellations) and Gemini API exceptions into clear user-friendly messages.
- **`CacheFailure`**: Guards local storage read/write failures (`SharedPreferences`).
- **`FormatFailure`**: Safeguards against corrupted JSON serialization or unexpected response formats.
- **Real-Time Connectivity Stream**: `BotView` wraps the interface in a `StreamBuilder<List<ConnectivityResult>>` that displays `CustomDialog` if connection is lost, preventing failed network requests before they are fired.
- **Lifecycle Protection (`isClosed`)**: All asynchronous operations in `BotCubit` check `if (isClosed) return;` and `if (!isClosed) emit(...)` to guarantee that state is never emitted after a widget is unmounted.

---

## 🤖 Continuous Integration & Automated Testing

Craft incorporates automated testing covering both business logic and UI smoke verification:

- **Unit Testing (`test/bot_cubit_test.dart`)**:
  - `FakeHomeRepo` implementation verifying mockability.
  - Tests initial state cache restoration.
  - Tests message dispatching, state transitions (`BotWaitingForResponse` → `BotMessageSent`), and AI response generation.
  - Tests error handling and state emission on network/API failure (`BotFailure`).
  - Tests chat archiving and history clearing via `startNewChat()`.
- **Widget Testing (`test/widget_test.dart`)**: Smoke tests verifying clean app startup, router configuration, and dependency initialization.

Run all tests via:
```bash
flutter test
```

---

## 🚀 Getting Started / Installation

### **Prerequisites**
- **Flutter SDK**: `>= 3.5.0` ([Flutter Install Guide](https://docs.flutter.dev/get-started/install))
- **Dart SDK**: Bundled with Flutter
- **Git**
- **Google Gemini API Key**: Get a free key at [Google AI Studio](https://aistudio.google.com/)

### **Installation Steps**

1. **Clone the Repository**:
   ```bash
   git clone https://github.com/Mohamed3li454/craft_app.git
   cd craft_app
   ```

2. **Install Dependencies**:
   ```bash
   flutter pub get
   ```

3. **Configure Environment Secrets**:
   Create a `.env` file inside the `assets/` directory (see [Environment Configuration](#-environment-configuration)):
   ```bash
   cp assets/.env.example assets/.env
   ```
   Add your Gemini API key inside `assets/.env`.

4. **Run the Application**:
   ```bash
   flutter run
   ```

5. **Execute Test Suite**:
   ```bash
   flutter test
   ```

---

## 🔐 Environment Configuration

Craft uses `flutter_dotenv` to load sensitive API credentials securely at runtime without committing secrets to version control.

Ensure `assets/.env` contains:

```env
API_KEY=your_actual_gemini_api_key_here
GEMINI_MODEL=gemini-3.6-flash
GEMINI_FALLBACK_MODEL=gemini-3.1-flash-lite
```

> **Note**: `assets/.env` is ignored by `.gitignore` to prevent credential exposure. If `.env` is absent at startup, `main.dart` catches the error gracefully.

---

## 📄 License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.
