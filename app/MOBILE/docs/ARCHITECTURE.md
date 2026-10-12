# BERGMAN Race — Architecture

Status: Draft for approval
Scope: Official native mobile application only

This document defines the technology stack, application architecture, folder structure, and boundaries. It aligns with the originating proposal in [mobile-architecture.md](mobile-architecture.md) and refines the folder model to the feature-first layout requested for this project.

## 1. Technology Stack

Only the approved stack should be used:

- Expo SDK (latest stable)
- React Native
- Expo Router (file-system routing)
- TypeScript (strict)
- React Query (server state)
- Zustand (client state)
- Axios (HTTP client)
- React Hook Form (forms)
- Zod (validation)
- React Native Maps (course maps)
- Expo Secure Store (tokens)
- Expo Notifications (push)
- React Native Reanimated (motion)
- React Native Gesture Handler (gestures)
- React Native SVG (vector assets and icons)

No backend, database, Firebase, Cloudflare, or direct infrastructure SDK should be added to the mobile app.

## 2. Architectural Goals

- Native-quality experience with excellent perceived performance.
- Clear separation between presentation, client state, REST data access, and device integrations.
- Feature isolation: each feature is self-contained and reusable.
- Strong dark mode, tablet-aware layouts, and accessibility throughout.
- Offline-tolerant behavior for previously viewed data.

## 3. Layered Architecture

The app is organized into clear layers with one-directional dependencies:

1. Routing layer (`app/`): Expo Router route definitions and composition only.
2. Feature layer (`src/features/`): feature-specific hooks, orchestration, and types.
3. Presentation layer (`src/components/`): reusable UI with no direct network calls.
4. Data access layer (`src/services/`): REST client, endpoint modules, and schema validation.
5. State layer (`src/store/`): global client state via Zustand.
6. Foundation (`src/theme/`, `src/hooks/`, `src/utils/`, `src/types/`, `src/assets/`): cross-cutting building blocks.

Rules:

- Screens compose features and components; they never call Axios directly.
- Components never call the network and never own server state.
- Features own React Query hooks and connect data access to presentation.
- The data access layer is the only place that talks to REST APIs.

## 4. Folder Structure

The app uses a domain-oriented, feature-first structure with a clear split between
the platform layer (`core`), reusable UI (`shared`), and domain features (`features`).

```text
src/
  app/                      # Expo Router route definitions ONLY (thin; delegates composition)
  core/                     # Platform layer: cross-cutting foundation, no feature logic
    navigation/             # Root layout composition, routes/deep links, navigation types
    constants/              # Environment + app configuration
    theme/                  # Design tokens + ThemeProvider (light/dark/system)
    services/               # REST data access + device integrations
      api/
        client/             # Axios instance
        interceptors/       # Auth + error-normalization interceptors
        queryKeys.ts        # Centralized React Query keys
        (endpoints/, schemas/ are added as endpoints are implemented)
      auth/                 # Secure Store-backed token storage
      query/                # React Query client
    store/                  # Global Zustand stores (app, preferences, session)
    providers/              # AppProviders, QueryProvider, ErrorBoundary, LoadingProvider
    hooks/                  # App-level hooks (color scheme, session bootstrap)
    types/                  # Shared types (api)
    utils/                  # Framework-independent utilities (format, platform)
  features/                 # Domain features (each: components/, hooks/, types.ts, index.ts)
    home/
    events/
    tracking/               # Largest domain: live race experience
      leaderboard/
      athlete-search/
      athlete-details/
      watchlist/
      course-map/
    athlete/                # Athlete hub: my events, results, certificates, profile
    auth/                   # Athlete authentication
    notifications/
    settings/
  shared/                   # Reusable, presentation-only UI (no REST calls)
    components/
      ui/
      race/
      map/
      feedback/
      layout/
  assets/                   # App-level assets (fonts, images, SVGs)
```

Notes:

- This refines the proposal in [mobile-architecture.md](mobile-architecture.md) into a
  domain-oriented layout: cross-cutting platform code lives in `core/`, reusable UI in
  `shared/`, and features are grouped into seven domains. `tracking` is the largest module
  and consolidates leaderboard, athlete search, athlete details, watchlist, and course map.
- `app/` contains route definitions only; all navigation composition (root layout, gesture
  root, providers wiring, session bootstrap) lives in `core/navigation`.
- `core/services/api/endpoints` and `core/services/api/schemas` follow the module patterns
  in [API_INTEGRATION.md](API_INTEGRATION.md) and are created as endpoints are implemented.

## 5. Boundaries and Dependency Rules

- `app/` contains only route definitions; it delegates composition to `core/navigation` and must not import the data layer directly.
- `features/` may depend on `core` (navigation, services, store, hooks, theme, utils, types) and `shared`.
- `shared/` may depend only on `core/theme`, `core/utils`, `core/types`, and other shared components.
- `core/services` may depend on `core/types`, `core/constants`, and `core/utils`; it must not import UI.
- `core/store` may depend on `core/services` (for bootstrap) and `core/types`; it must not import UI.
- No module may import a backend/database/infra SDK.

## 6. Cross-Cutting Concerns

- Theming: a single theme provider bridges design tokens to components; see [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md).
- Navigation: Expo Router with route groups; see [NAVIGATION.md](NAVIGATION.md).
- State: React Query for server state, Zustand for client state; see [STATE_MANAGEMENT.md](STATE_MANAGEMENT.md).
- Errors: a normalized app-level error model surfaced consistently across screens; see [API_INTEGRATION.md](API_INTEGRATION.md).
- Motion: Reanimated and Gesture Handler for interruptible, reduce-motion-aware animations.

## 7. App Bootstrap Sequence

The root layout composes providers in a deterministic order:

1. App providers (safe area, gesture handler root).
2. Theme bridge (resolves color mode from preferences/system).
3. Query client provider (React Query).
4. Auth session bootstrap (read tokens from Secure Store).
5. Notification bootstrap (handlers and response routing; no permission prompt).
6. Deep link handling (route resolution from links and notification payloads).

Authenticated routes render only after auth bootstrap completes; guest mode remains available throughout.

## 8. Configuration

- Base URL and public configuration come from Expo public environment variables.
- API URL paths are mapped after the API contract is provided; no paths are hardcoded before then.
- Secrets and tokens are never placed in source or environment files committed to the repo.

## 9. Environments

- Development, staging, and production configurations are selected via Expo environment variables and app config.
- Map provider keys and notification configuration are provided per environment at approval time.
