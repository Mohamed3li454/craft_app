# Flutter Clean Architecture & Engineering Blueprint
> **Universal AI Prompt & Engineering Standards Guide**  
> *Use this document as a system prompt or reference guide for any AI assistant (ChatGPT, Claude, Cursor, Antigravity, Copilot) to generate and maintain clean, production-grade Flutter applications following this exact architectural pattern.*

---

## 0. AI System Prompt & Role Definition

```text
You are a Principal Flutter & Dart Architect. When building, refactoring, or extending Flutter applications, you MUST strictly adhere to the Feature-First Clean Architecture and coding conventions documented in this blueprint.

Key Mandates:
1. Architecture: Feature-first organization (lib/constants, lib/core, lib/features).
2. State Management: Flutter Bloc (specifically Cubit) with Equatable. Never use raw setState for business logic.
3. Safety: ALWAYS guard state emissions with `if (!isClosed)` / `if (isClosed) return;`.
4. Error Handling: Functional error handling using `dartz` (Either<Failure, T>).
5. Dependency Injection: Constructor injection with fallback to `ServiceLocator` (for zero-param widget usage and 100% test mockability).
6. Routing: Declarative routing with `go_router` and centralized route paths.
7. Modular UI: Decompose screens into granular sub-widgets inside a feature-local `widgets/` folder. No monolithic build methods.
8. Theme & Colors: Zero hardcoded hex colors or inline styles. Use centralized `AppColors`, `AppTheme`, and `BuildContext` extensions.
```

---

## 1. Architectural Overview & Philosophy

The project follows a **Feature-First Clean Architecture** specifically optimized for Flutter. It eliminates unnecessary boilerplate (such as artificial use-cases and entity mappings when models already represent data contracts) while strictly enforcing **Separation of Concerns**, **Dependency Inversion**, and **Unidirectional Data Flow**.

### Unidirectional Data Flow

```
┌─────────────────────────────────────────────────────────────┐
│                     PRESENTATION LAYER                      │
│                                                             │
│   ┌──────────────────────┐          ┌───────────────────┐   │
│   │    View / Screen     │ ───────► │   View Widgets    │   │
│   │ (Provides Cubit via  │          │ (BlocBuilder /    │   │
│   │    BlocProvider)     │          │  BlocConsumer)    │   │
│   └──────────┬───────────┘          └─────────▲─────────┘   │
│              │                                │             │
│              │  Calls methods                 │ Emits State │
│              ▼                                │             │
│   ┌───────────────────────────────────────────┴─────────┐   │
│   │                  Cubit (Manager)                    │   │
│   │  (Extends Cubit<State>, checks isClosed, uses fold) │   │
│   └──────────────────────────┬──────────────────────────┘   │
└──────────────────────────────┼──────────────────────────────┘
                               │ Calls Repository Interface
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                         DATA LAYER                          │
│                                                             │
│   ┌─────────────────────────────────────────────────────┐   │
│   │               Repository Interface                  │   │
│   │    abstract class FeatureRepo {                     │   │
│   │      Future<Either<Failure, T>> getData();          │   │
│   │    }                                                │   │
│   └──────────────────────────┬──────────────────────────┘   │
│                              │ Implements
│                              ▼
│   ┌─────────────────────────────────────────────────────┐   │
│   │             Repository Implementation               │   │
│   │  - Catches DioException & Maps to ServerFailure     │   │
│   │  - Handles Offline Caching & TTL (Hive)             │   │
│   │  - Returns Right(data) or Left(Failure)             │   │
│   └──────────────┬───────────────────────────┬──────────┘   │
│                  │                           │              │
│                  ▼                           ▼              │
│        ┌───────────────────┐       ┌───────────────────┐    │
│        │    Remote Data    │       │    Local Data     │    │
│        │ (ApiService/Dio)  │       │ (Hive/SharedPref) │    │
│        └───────────────────┘       └───────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Directory Structure (`lib/` Anatomy)

```text
lib/
│
├── constants/                      # Global, compile-time constants
│   ├── app_colors.dart             # Unified color palette & semantic tokens
│   └── hive_constants.dart         # Hive box names & storage keys
│
├── core/                           # Shared infrastructure across all features
│   ├── di/
│   │   └── service_locator.dart    # Manual DI / Service Locator registry
│   ├── errors/
│   │   └── failure.dart            # Failure hierarchy (ServerFailure, CacheFailure, FormatFailure)
│   ├── models/
│   │   └── [shared_model].dart     # Domain models used across multiple features
│   ├── services/                   # Global utility services (Connectivity, Background, etc.)
│   ├── theme/
│   │   └── app_theme.dart          # Light/Dark ThemeData and BuildContext extensions
│   ├── utils/
│   │   ├── api_service.dart        # Direct HTTP/REST client wrapper
│   │   ├── dio_factory.dart        # Configured Dio instance (timeouts, interceptors)
│   │   └── app_routes.dart         # Static route name constants
│   └── widgets/                    # App-wide reusable UI components
│       ├── app_dialog.dart         # Custom toasts / bottom-sheets / dialogs
│       ├── custom_error_widget.dart# Standard error view with retry callback
│       ├── fade_slide_in.dart      # Motion & staggered list animation wrappers
│       ├── offline_banner.dart     # Global network banner
│       ├── page_transitions.dart   # Reusable GoRouter page transitions
│       ├── router.dart             # GoRouter instance & route table
│       └── shimmer_container.dart  # Skeleton loading placeholder
│
├── features/                       # Independent, self-contained business features
│   └── [feature_name]/             # e.g., home, explore, details, downloads, settings
│       ├── data/                   # Data handling for this feature
│       │   ├── models/             # Feature-specific models (if not in core)
│       │   ├── repos/              # Repository contracts and implementations
│       │   │   ├── [feature]_repo.dart       # Abstract interface
│       │   │   └── [feature]_repo_impl.dart  # Concrete implementation
│       │   └── services/           # Feature-specific local/remote services (optional)
│       │
│       └── presentation/           # Presentation handling for this feature
│           ├── manager/            # State management (Cubit + States)
│           │   └── [cubit_name]_cubit/
│           │       ├── [cubit_name]_cubit.dart
│           │       └── [cubit_name]_state.dart
│           └── view/               # Screens and UI
│               ├── [feature]_view.dart       # Main view entry point (provides Cubit)
│               └── widgets/                  # Modular sub-widgets for this view
│                   ├── [feature]_view_body.dart
│                   ├── [feature]_item_card.dart
│                   └── [feature]_shimmer_loading.dart
│
└── main.dart                       # App entry point, bootstrap, root providers, theme wiring
```

---

## 3. Essential Tech Stack & Package Roles

| Category | Package | Version | Responsibility |
| :--- | :--- | :--- | :--- |
| **State Management** | `flutter_bloc` | `^9.1.1` | Predictable, reactive state management using Cubits. |
| **Equality & Immutability** | `equatable` | `^2.1.0` | Value equality for states and models without manual operator overrides. |
| **HTTP Networking** | `dio` | `^5.11.0` | Powerful HTTP client with timeouts, base options, and debug logging. |
| **Functional Programming** | `dartz` | `^0.10.1` | `Either<Failure, T>` return type for safe, compiler-checked error handling. |
| **Navigation & Routing** | `go_router` | `^17.3.0` | Declarative routing, deep linking, parameter passing, and custom transitions. |
| **Fast Local NoSQL DB** | `hive_flutter` | `^1.1.0` | High-performance key-value & document offline caching with TTL. |
| **Key-Value Storage** | `shared_preferences` | `^2.5.5` | Lightweight persistence for flags (onboarding, active theme mode). |
| **Network Monitoring** | `connectivity_plus` | `^6.1.4` | Real-time network reachability detection wired to a global Cubit. |
| **Image Caching** | `cached_network_image` | `^3.4.1` | Automatic disk & memory caching of remote images with placeholders. |
| **Shimmer Skeletons** | `shimmer` | `^3.0.0` | Modern content placeholder animations during loading states. |
| **Typography** | `google_fonts` | `^8.2.0` | Centralized, performant typography. |
| **Animations** | `lottie` | `^3.5.1` | Vector animations for empty states, splash, and celebration dialogs. |

---

## 4. State Management with Cubit: Rules & Patterns

### 1. File Organization: Part & Part Of
Every Cubit MUST be split into two files using Dart's `part` and `part of` directives:
- `[name]_cubit.dart` contains `part '[name]_state.dart';`
- `[name]_state.dart` contains `part of '[name]_cubit.dart';`

*Why*: This treats the Cubit and its States as a single compilation unit, eliminating circular imports and keeping state classes clean and private to the feature module if desired.

### 2. State Design with `Equatable`
- The base state class MUST be `abstract`, extend `Equatable`, have a `const` constructor, and override `List<Object?> get props => [];`.
- Every sub-state subclassing it MUST pass its properties into `props` to prevent unnecessary UI rebuilds.
- Standard lifecycle states:
  - `[Feature]Initial`
  - `[Feature]Loading`
  - `[Feature]Success` (holds data)
  - `[Feature]Failure` (holds `errMessage: String`)
  - Optional: `[Feature]Empty` (when a query returns 0 results)

### 3. Constructor Dependency Injection
Every Cubit MUST inject its dependencies via the constructor with a default fallback to `ServiceLocator`:

```dart
class FeaturedBooksCubit extends Cubit<FeaturedBooksState> {
  final HomeRepo homeRepo;

  // Defaults to ServiceLocator in production, allows mock injection in unit tests!
  FeaturedBooksCubit({HomeRepo? homeRepo})
      : homeRepo = homeRepo ?? ServiceLocator.homeRepo,
        super(FeaturedBooksInitial());
}
```

### 4. Mandatory Lifecycle Protection (`isClosed`)
Calling `emit()` after a Cubit is closed throws an unhandled exception in Flutter Bloc. You **MUST** guard all asynchronous callbacks:
1. `if (isClosed) return;` immediately after awaiting any asynchronous call.
2. `if (!isClosed)` inside both branches of `.fold(...)`.

```dart
Future<void> fetchFeaturedBooks() async {
  emit(FeaturedBooksLoading());

  final result = await homeRepo.fetchFeaturedBooks();
  if (isClosed) return; // Guard 1

  result.fold(
    (failure) {
      if (!isClosed) emit(FeaturedBooksFailure(failure.errMessage)); // Guard 2
    },
    (books) {
      if (!isClosed) emit(FeaturedBooksSuccess(books)); // Guard 3
    },
  );
}
```

### 5. Search Debouncing & Request Cancellation Pattern
When handling user search input in a Cubit:
- Use a `Timer? _debounceTimer` (e.g. 500ms - 650ms).
- Track an incrementing `_activeRequestId` to cancel and discard stale out-of-order network responses.

```dart
Timer? _debounceTimer;
int _activeRequestId = 0;

void searchDebounced(String query) {
  _debounceTimer?.cancel();
  final cleanQuery = query.trim();

  if (cleanQuery.isEmpty || cleanQuery.length < 2) {
    _activeRequestId++;
    resetSearch();
    return;
  }

  _debounceTimer = Timer(const Duration(milliseconds: 600), () {
    search(cleanQuery);
  });
}
```

### 6. UI Consumption Best Practices
- **Feature-Scoped Cubits**: Provided at the View root via `BlocProvider(create: (_) => MyCubit()..fetchData())`.
- **App-Scoped Cubits**: Provided at `MyApp` via `MultiBlocProvider` (e.g., `ThemeCubit`, `ConnectivityCubit`).
- **Smooth State Rendering**: Wrap UI in `BlocBuilder` and use `AnimatedSwitcher` with `KeyedSubtree(key: ValueKey(state.runtimeType))` for fluid state transitions.
- **Side Effects**: Use `BlocListener` or `BlocConsumer` for navigation, Snackbars, or dialogs. Never trigger navigation inside `BlocBuilder`.

---

## 5. Data Layer Architecture: Repositories, Caching & Models

### 1. Repository Interface
Define the contract strictly in `data/repos/[feature]_repo.dart`:
- Return types MUST be `Future<Either<Failure, T>>`.
- Methods declare intent (e.g., `fetchFeaturedBooks()`), not transport details.

### 2. Repository Implementation
Implement the contract in `data/repos/[feature]_repo_impl.dart`:
- Inject dependencies (`ApiService`, Hive boxes, etc.).
- Try remote first or local first based on caching strategy.
- Implement **TTL (Time To Live)** for cache freshness.
- Catch errors comprehensively:
  ```dart
  if (e is Failure) return left(e);
  if (e is DioException) return left(ServerFailure.fromDioError(e));
  if (e is FormatException || e is TypeError) return left(const FormatFailure());
  return left(const ServerFailure('Unexpected error occurred.'));
  ```

### 3. Data Models
Models MUST:
- Extend `Equatable`.
- Provide a robust `factory Model.fromJson(Map<String, dynamic> json)` with defensive parsing (safe type casting, handling both `null` and type mismatches, fallback values).
- Provide `Map<String, dynamic> toJson()`.
- Provide `Model copyWith(...)`.

---

## 6. Networking & Error Handling

### 1. DioFactory Pattern
Create a centralized `DioFactory` with standard timeouts and headers:

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

### 2. Comprehensive Failure Hierarchy
`Failure` extends `Equatable`:

```dart
abstract class Failure extends Equatable {
  final String errMessage;
  const Failure(this.errMessage);
  @override
  List<Object?> get props => [errMessage];
}

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

class CacheFailure extends Failure {
  const CacheFailure([super.message = 'Failed to load local offline data.']);
}

class FormatFailure extends Failure {
  const FormatFailure([super.message = 'Unable to process response data.']);
}
```

---

## 7. Dependency Injection (`ServiceLocator`)

Maintain a lightweight `ServiceLocator` initialized in `main()` before `runApp()`:

```dart
class ServiceLocator {
  ServiceLocator._();

  static late final ApiService apiService;
  static late final HomeRepo homeRepo;
  static late final SearchRepo searchRepo;

  static void init() {
    apiService = ApiService(DioFactory.dio);
    homeRepo = HomeRepoImpl(apiService: apiService);
    searchRepo = SearchRepoImpl(apiService: apiService);
  }
}
```

---

## 8. Routing & Custom Transitions (`go_router`)

### 1. Centralized Route Constants
Always define route paths in `AppRoutes`:

```dart
class AppRoutes {
  AppRoutes._();
  static const String splash = '/';
  static const String main = '/main';
  static const String details = '/details';
}
```

### 2. Route Configuration with Custom Transitions
Use fluid transitions (`fadeSlidePage`) to deliver a polished native feel:

```dart
final router = GoRouter(
  initialLocation: AppRoutes.splash,
  errorBuilder: (context, state) => const Scaffold(body: Center(child: Text('Page not found'))),
  routes: [
    GoRoute(
      path: AppRoutes.main,
      pageBuilder: (context, state) => fadeSlidePage(
        key: state.pageKey,
        child: const MainView(),
      ),
    ),
    GoRoute(
      path: AppRoutes.details,
      pageBuilder: (context, state) {
        final item = state.extra as ItemModel?;
        return fadeSlidePage(
          key: state.pageKey,
          child: DetailsView(item: item),
        );
      },
    ),
  ],
);
```

---

## 9. UI, Theming & Motion System

### 1. Centralized AppColors
All colors must live in `lib/constants/app_colors.dart`. No arbitrary hex values in widgets.

### 2. BuildContext Theme Extension
Extend `BuildContext` to make accessing themed properties concise:

```dart
extension ThemeHelper on BuildContext {
  ColorScheme get colors => Theme.of(this).colorScheme;
  bool get isDark => Theme.of(this).brightness == Brightness.dark;
  Color get titleColor => colors.onSurface;
  Color get mutedColor => isDark ? AppColors.darkMuted : AppColors.muted;
}
```

### 3. Custom Error & Shimmer Skeletons
- Always provide `CustomErrorWidget` with a clear message and `onRetry` callback.
- Always display `ShimmerContainer` skeleton loaders during `Loading` states instead of generic circular spinners for primary screens.

---

## 10. Step-by-Step Blueprint for Creating a New Feature

When an AI or engineer is instructed to **"Create Feature X"**, follow this exact sequence:

```text
Step 1: Create Folder Tree
└── lib/features/X/
    ├── data/
    │   ├── models/           # (If feature-specific)
    │   └── repos/
    │       ├── x_repo.dart
    │       └── x_repo_impl.dart
    └── presentation/
        ├── manager/
        │   └── x_cubit/
        │       ├── x_cubit.dart
        │       └── x_state.dart
        └── view/
            ├── x_view.dart
            └── widgets/
                ├── x_view_body.dart
                └── x_shimmer_loading.dart

Step 2: Write Data Model (data/models/x_model.dart)
        - Extends Equatable
        - fromJson, toJson, copyWith

Step 3: Write Repository Interface (data/repos/x_repo.dart)
        - Return Future<Either<Failure, T>>

Step 4: Write Repository Implementation (data/repos/x_repo_impl.dart)
        - Call ApiService / Hive
        - Catch exceptions & map to Failures

Step 5: Register in ServiceLocator (core/di/service_locator.dart)
        - static late final XRepo xRepo;
        - xRepo = XRepoImpl(apiService: apiService);

Step 6: Write Cubit & States (presentation/manager/x_cubit/)
        - Equatable states
        - Constructor DI with fallback to ServiceLocator.xRepo
        - Guard with `if (!isClosed)`

Step 7: Build View & Granular Widgets (presentation/view/)
        - XView wraps MultiBlocProvider / BlocProvider
        - XViewBody uses BlocBuilder with AnimatedSwitcher

Step 8: Register Route in AppRoutes & Router
        - Add static const String x = '/x';
        - Add GoRoute in router.dart
```

---

## 11. Production Boilerplate Templates (Copy-Paste Ready)

### Template 1: Repository Interface (`[feature]_repo.dart`)
```dart
import 'package:dartz/dartz.dart';
import 'package:my_app/core/errors/failure.dart';
import 'package:my_app/features/sample/data/models/sample_model.dart';

abstract class SampleRepo {
  Future<Either<Failure, List<SampleModel>>> fetchSampleItems();
}
```

### Template 2: Repository Implementation (`[feature]_repo_impl.dart`)
```dart
import 'package:dartz/dartz.dart';
import 'package:dio/dio.dart';
import 'package:my_app/core/errors/failure.dart';
import 'package:my_app/core/utils/api_service.dart';
import 'package:my_app/features/sample/data/models/sample_model.dart';
import 'package:my_app/features/sample/data/repos/sample_repo.dart';

class SampleRepoImpl implements SampleRepo {
  final ApiService apiService;

  SampleRepoImpl({required this.apiService});

  @override
  Future<Either<Failure, List<SampleModel>>> fetchSampleItems() async {
    try {
      final response = await apiService.getData(endPoint: 'items');
      final rawList = response['data'] as List<dynamic>? ?? [];
      final items = rawList
          .map((item) => SampleModel.fromJson(Map<String, dynamic>.from(item as Map)))
          .toList();
      return right(items);
    } catch (e) {
      if (e is Failure) return left(e);
      if (e is DioException) return left(ServerFailure.fromDioError(e));
      if (e is FormatException || e is TypeError) return left(const FormatFailure());
      return left(const ServerFailure('Failed to load items. Please try again.'));
    }
  }
}
```

### Template 3: Cubit States (`[feature]_state.dart`)
```dart
part of 'sample_cubit.dart';

abstract class SampleState extends Equatable {
  const SampleState();

  @override
  List<Object?> get props => [];
}

class SampleInitial extends SampleState {}

class SampleLoading extends SampleState {}

class SampleSuccess extends SampleState {
  final List<SampleModel> items;

  const SampleSuccess(this.items);

  @override
  List<Object?> get props => [items];
}

class SampleFailure extends SampleState {
  final String errMessage;

  const SampleFailure(this.errMessage);

  @override
  List<Object?> get props => [errMessage];
}
```

### Template 4: Cubit (`[feature]_cubit.dart`)
```dart
import 'package:equatable/equatable.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:my_app/core/di/service_locator.dart';
import 'package:my_app/features/sample/data/models/sample_model.dart';
import 'package:my_app/features/sample/data/repos/sample_repo.dart';

part 'sample_state.dart';

class SampleCubit extends Cubit<SampleState> {
  final SampleRepo sampleRepo;

  SampleCubit({SampleRepo? sampleRepo})
      : sampleRepo = sampleRepo ?? ServiceLocator.sampleRepo,
        super(SampleInitial());

  Future<void> fetchItems() async {
    emit(SampleLoading());

    final result = await sampleRepo.fetchSampleItems();
    if (isClosed) return;

    result.fold(
      (failure) {
        if (!isClosed) emit(SampleFailure(failure.errMessage));
      },
      (items) {
        if (!isClosed) emit(SampleSuccess(items));
      },
    );
  }
}
```

### Template 5: View & Widgets (`[feature]_view.dart`)
```dart
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:my_app/features/sample/presentation/manager/sample_cubit/sample_cubit.dart';
import 'package:my_app/features/sample/presentation/view/widgets/sample_view_body.dart';

class SampleView extends StatelessWidget {
  const SampleView({super.key});

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (context) => SampleCubit()..fetchItems(),
      child: const Scaffold(
        body: SafeArea(
          child: SampleViewBody(),
        ),
      ),
    );
  }
}
```

### Template 6: View Body with Smooth Transitions (`[feature]_view_body.dart`)
```dart
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:my_app/core/widgets/custom_error_widget.dart';
import 'package:my_app/features/sample/presentation/manager/sample_cubit/sample_cubit.dart';
import 'package:my_app/features/sample/presentation/view/widgets/sample_shimmer_loading.dart';

class SampleViewBody extends StatelessWidget {
  const SampleViewBody({super.key});

  @override
  Widget build(BuildContext context) {
    return BlocBuilder<SampleCubit, SampleState>(
      builder: (context, state) {
        Widget content;

        if (state is SampleLoading) {
          content = const SampleShimmerLoading();
        } else if (state is SampleSuccess) {
          content = ListView.builder(
            itemCount: state.items.length,
            itemBuilder: (context, index) {
              final item = state.items[index];
              return ListTile(title: Text(item.title));
            },
          );
        } else if (state is SampleFailure) {
          content = CustomErrorWidget(
            errMessage: state.errMessage,
            onRetry: () => context.read<SampleCubit>().fetchItems(),
          );
        } else {
          content = const SizedBox.shrink();
        }

        return AnimatedSwitcher(
          duration: const Duration(milliseconds: 280),
          child: KeyedSubtree(
            key: ValueKey(state.runtimeType),
            child: content,
          ),
        );
      },
    );
  }
}
```

---

## 12. Strict Coding Rules (Checklist for AI & Developers)

| DO | DON'T |
| :--- | :--- |
| ✅ Always check `if (!isClosed)` and `if (isClosed) return;` in Cubits. | ❌ Never emit a state without checking `isClosed`. |
| ✅ Inject dependencies into Cubits with `= repo ?? ServiceLocator.repo`. | ❌ Never hardcode static singleton calls inside Cubit methods. |
| ✅ Use `dartz` `Either<Failure, T>` for all repository methods. | ❌ Never throw raw uncaught exceptions from repositories to Cubits. |
| ✅ Put states in a `part of` file and use `Equatable` with `props`. | ❌ Never create multiple states in random files or omit `props`. |
| ✅ Provide feature Cubits inside the View or Router `pageBuilder`. | ❌ Never pollute `MyApp` with feature-specific Cubits. |
| ✅ Break UI into small focused widgets under `widgets/`. | ❌ Never write 300+ line monolithic `build()` methods. |
| ✅ Use `CustomErrorWidget` with an `onRetry` callback. | ❌ Never show a blank screen or unformatted red text on error. |
| ✅ Use `ShimmerContainer` or custom skeletons for loading. | ❌ Never rely solely on a basic spinner for whole-page loads. |
| ✅ Put all route strings in `AppRoutes`. | ❌ Never hardcode route strings like `'/home'` in widgets. |
| ✅ Use `AppColors` and `Theme.of(context)` / `context.colors`. | ❌ Never hardcode `Color(0xFF...)` inside view widgets. |
