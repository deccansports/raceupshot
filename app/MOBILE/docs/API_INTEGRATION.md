# BERGMAN Race — API Integration

Status: Draft for approval
Scope: Official native mobile application only

The mobile app accesses existing REST APIs through Axios endpoint modules only. No screen calls Axios directly. Actual URL paths are mapped after the API contract is provided.

## 1. Location

The data access layer lives under `src/services/api/`:

```text
src/services/api/
  client.ts          # Axios instance, interceptors, error normalization
  queryKeys.ts       # Centralized React Query keys
  endpoints/
    athletes.ts
    auth.ts
    certificates.ts
    events.ts
    leaderboards.ts
    notifications.ts
    results.ts
  schemas/
    athlete.schema.ts
    auth.schema.ts
    event.schema.ts
    leaderboard.schema.ts
    result.schema.ts
```

## 2. API Client Responsibilities

- Base URL configuration from Expo public environment variables.
- Authorization header injection from Secure Store-backed auth state.
- Request timeout defaults.
- Error normalization into the app error model.
- Response schema validation with Zod for critical payloads.
- Token refresh orchestration if the existing API supports refresh tokens.
- Network status-aware retries for idempotent requests.
- Request cancellation support (Axios signal/AbortController) integrated with React Query.

## 3. Endpoint Module Pattern

Each endpoint module exposes typed functions and returns validated data. Examples:

- `getUpcomingEvents`
- `getLiveEvents`
- `getEventDetail`
- `getLeaderboard`
- `searchAthletes`
- `getAthleteDetail`
- `getCourseMap`
- `getWatchlist`
- `updateWatchlist`
- `loginAthlete`
- `getMyEvents`
- `getResults`
- `getCertificate`
- `getProfile`
- `updateNotificationPreferences`

Endpoint functions accept an optional abort signal and typed params; they never contain UI logic.

## 4. Data Flow

```text
Screen (app/) → Feature hook (React Query) → Endpoint module → Axios client → REST API
                                   ↑                                   |
                                   └─────── Zod validation ────────────┘
```

- Features wrap endpoint modules in React Query hooks (see [STATE_MANAGEMENT.md](STATE_MANAGEMENT.md)).
- Components receive already-fetched, validated data via props or feature hooks.

## 5. Error Model

Normalize errors into a small app-level shape:

- `status`
- `code`
- `message`
- `userMessage`
- `isNetworkError`
- `isAuthError`
- `retryable`

This enables consistent `ErrorState`/`ErrorView` rendering and retry behavior across screens.

## 6. Authentication and Tokens

- Tokens are stored only in Expo Secure Store (access token, refresh token if provided, expiration metadata).
- The client injects the Authorization header from the Secure Store-backed auth state.
- Raw tokens are never exposed to screen components.
- On `isAuthError`, the app returns athlete-only flows to login while preserving public context.

## 7. Validation Strategy

Use Zod at API boundaries for:

- Authentication responses.
- Event details.
- Leaderboard rows.
- Athlete tracking state.
- Certificate metadata.
- Profile data.

Validation protects the app from malformed responses while preserving graceful partial failure where appropriate.

## 8. Request Lifecycle Requirements

Every request supports:

- Loading state (via React Query status).
- Error state (normalized error model).
- Retry (React Query retry + user-triggered retry).
- Cancellation (abort signal on unmount or query key change).
- Offline behavior (serve cache; see caching in [STATE_MANAGEMENT.md](STATE_MANAGEMENT.md)).

## 9. Guardrails

- No screen imports Axios directly.
- No API URL paths are hardcoded before the contract is finalized.
- No backend/database/infra SDKs are added.
- Notification push-token registration goes through the notifications endpoint module.
