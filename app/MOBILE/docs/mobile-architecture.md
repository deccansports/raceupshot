# BERGMAN Race Mobile Architecture Proposal

Status: Draft for approval
Scope: Official native mobile application only
Platforms: iOS and Android
Out of scope: backend services, APIs, Cloudflare Workers, Firestore, Cloudflare KV, direct database access

## 1. Product Architecture

BERGMAN Race is a premium Expo React Native application for endurance race discovery, live tracking, athlete following, results, certificates, and athlete account features. The mobile app consumes existing REST APIs exclusively and treats backend systems as external dependencies.

### Primary user types

- Guest / Spectator
  - Discover upcoming and live events.
  - Search athletes.
  - View leaderboards, maps, athlete details, and public results.
  - Build a watchlist and receive race notifications.
- Athlete
  - Authenticate with the existing athlete login API.
  - View personal events, results, certificates, profile, settings, and notification preferences.

### Architectural goals

- Native-quality user experience comparable to Strava, Garmin Connect, Nike Run Club, Apple Fitness, and IRONMAN Tracker.
- Minimal, premium interface with excellent perceived performance.
- Strong dark mode support.
- Tablet-aware layouts.
- Accessible interactions, typography, color contrast, and screen reader labels.
- Offline-tolerant behavior for previously viewed data.
- Clear separation between mobile presentation, state, REST data access, and device integrations.

## 2. Technology Stack

Only the approved stack should be used:

- Expo SDK latest stable version
- React Native
- Expo Router
- TypeScript
- React Query
- Zustand
- Axios
- React Hook Form
- Zod
- Expo Notifications
- Expo Secure Store
- React Native Maps
- React Native Reanimated
- React Native Gesture Handler

No backend, database, Firebase, Cloudflare, or direct infrastructure SDKs should be added to the mobile app.

## 3. Navigation Design

Navigation should be implemented with Expo Router using file-system routing. The app should use route groups to separate public guest flows, authenticated athlete flows, shared modal flows, and onboarding/auth flows.

### Route groups

```text
app/
  _layout.tsx
  (tabs)/
    _layout.tsx
    index.tsx
    events.tsx
    watchlist.tsx
    results.tsx
    profile.tsx
  events/
    [eventId]/
      _layout.tsx
      index.tsx
      leaderboard.tsx
      athletes.tsx
      map.tsx
  athletes/
    [athleteId].tsx
  auth/
    login.tsx
  settings/
    index.tsx
    notifications.tsx
    appearance.tsx
  certificates/
    [certificateId].tsx
  modals/
    search.tsx
    filters.tsx
```

This is a proposed route model only. Actual screen implementation should wait for approval.

### Navigation hierarchy

- Root layout
  - App providers
  - Theme bridge
  - Query client provider
  - Auth session bootstrap
  - Notification bootstrap
  - Deep link handling
- Main tabs
  - Home
  - Events
  - Watchlist
  - Results
  - Profile
- Event stack
  - Event Details
  - Leaderboard
  - Athlete Search
  - Course Map
- Athlete stack
  - Athlete Detail
  - Tracking timeline
  - Splits and status
- Auth stack
  - Athlete Login
- Settings stack
  - Profile settings
  - Notification settings
  - Appearance

### Deep links

Deep links should support:

- Event detail: `bergmanrace://events/:eventId`
- Athlete detail: `bergmanrace://athletes/:athleteId`
- Certificate: `bergmanrace://certificates/:certificateId`
- Live event: `bergmanrace://events/:eventId/live`

Push notification payloads should use the same route targets.

## 4. Folder Structure

The app should use a feature-oriented structure with shared platform systems isolated from screens.

```text
src/
  api/
    client.ts
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
    queryKeys.ts
  components/
    primitives/
      Avatar.tsx
      Badge.tsx
      Button.tsx
      Card.tsx
      Divider.tsx
      IconButton.tsx
      Input.tsx
      ListItem.tsx
      Screen.tsx
      Text.tsx
    feedback/
      EmptyState.tsx
      ErrorState.tsx
      LoadingState.tsx
      Skeleton.tsx
    maps/
      CourseMap.tsx
      MarkerCluster.tsx
      SplitMarker.tsx
    race/
      AthleteCard.tsx
      EventCard.tsx
      LeaderboardRow.tsx
      SplitTimeline.tsx
      TrackingStatusPill.tsx
  features/
    athlete/
      hooks/
      types.ts
    auth/
      hooks/
      store.ts
      types.ts
    certificates/
      hooks/
      types.ts
    events/
      hooks/
      types.ts
    leaderboard/
      hooks/
      types.ts
    maps/
      hooks/
      types.ts
    notifications/
      hooks/
      service.ts
      types.ts
    results/
      hooks/
      types.ts
    watchlist/
      hooks/
      store.ts
      types.ts
  lib/
    analytics.ts
    constants.ts
    date.ts
    errors.ts
    format.ts
    storage.ts
  state/
    app.store.ts
    preferences.store.ts
  theme/
    colors.ts
    spacing.ts
    typography.ts
    shadows.ts
    theme.ts
  types/
    api.ts
    navigation.ts
  utils/
    accessibility.ts
    device.ts
    platform.ts
```

### Boundaries

- `app/`: Expo Router route definitions and composition only.
- `src/api/`: REST clients, endpoint functions, Zod validation, and query keys.
- `src/features/`: feature-specific hooks, types, and local orchestration.
- `src/components/`: reusable UI components with no direct REST calls.
- `src/state/`: small persistent app preferences and cross-feature client state.
- `src/theme/`: design tokens and color mode logic.
- `src/lib/`: framework-independent utilities.

## 5. Reusable Component Library

The component library should be small, consistent, and optimized for native feel.

### Primitive components

- `Screen`
  - Handles safe areas, background color, keyboard avoidance, scroll behavior, and tablet max-width options.
- `Text`
  - Centralizes typography variants, colors, accessibility roles, and dynamic type support.
- `Button`
  - Variants: primary, secondary, ghost, destructive, icon.
  - States: default, pressed, loading, disabled.
- `Card`
  - Standard content container for event, athlete, result, and certificate summaries.
- `Input`
  - React Hook Form integration, error text, accessibility labels, and dark mode styling.
- `ListItem`
  - Shared row layout for settings, athletes, events, and search results.
- `Badge`
  - Live, upcoming, finished, category, age group, rank, and status badges.

### Feedback components

- `LoadingState`
- `Skeleton`
- `EmptyState`
- `ErrorState`
- `OfflineBanner`
- `RefreshControl`

### Race-specific components

- `EventCard`
- `AthleteCard`
- `LeaderboardRow`
- `SplitTimeline`
- `TrackingStatusPill`
- `CourseMap`
- `SplitMarker`

### Motion principles

Use React Native Reanimated and Gesture Handler for:

- Press feedback.
- Bottom sheet gestures.
- Map overlay transitions.
- Watchlist add/remove micro-interactions.
- Skeleton-to-content transitions.
- Tab and stack transitions where Expo Router allows customization.

Animations should be short, interruptible, and reduce motion when the user has reduced motion enabled.

## 6. State Management

Use React Query for server state and Zustand for client state.

### React Query responsibilities

- Events
- Live event data
- Event details
- Leaderboards
- Athlete search
- Athlete details
- Course maps
- Results
- Certificates
- Profile data
- Notification preference data fetched from REST APIs

### Zustand responsibilities

- Auth session metadata after Secure Store bootstrap
- Watchlist IDs and optimistic UI state
- User preferences:
  - color scheme preference
  - units
  - notification toggles mirrored locally
  - recently viewed events
  - selected event filters
- App UI state:
  - onboarding seen
  - offline banner visibility
  - last selected tab or event context where useful

### Secure storage

Expo Secure Store should hold sensitive values only:

- access token
- refresh token, if provided by the existing API
- token expiration metadata

Do not store full profile data or large API payloads in Secure Store.

## 7. Theme System

The theme should provide a premium, high-contrast design with light and dark modes.

### Design tokens

- Color
  - background
  - surface
  - elevated surface
  - text primary
  - text secondary
  - text muted
  - border
  - accent
  - success
  - warning
  - danger
  - live
- Spacing
  - 4, 8, 12, 16, 20, 24, 32, 40, 48
- Radius
  - small, medium, large, full
- Typography
  - display
  - title
  - headline
  - body
  - body small
  - label
  - mono metric
- Elevation
  - card
  - floating control
  - modal

### Color mode behavior

- Default to system color scheme.
- Allow explicit light, dark, or system preference.
- Persist appearance preference with Zustand persistence.
- Ensure maps, charts, skeletons, and status colors have dark mode variants.

### Accessibility

- Maintain WCAG-friendly contrast for all text and controls.
- Support dynamic type.
- Ensure touch targets are at least 44 x 44 points.
- Provide semantic labels for map controls, tracking status, ranks, and certificates.
- Avoid color-only status communication.

## 8. REST API Layer

The mobile app should access existing REST APIs through Axios endpoint modules only. No screen should call Axios directly.

### API client responsibilities

- Base URL configuration from Expo public environment variables.
- Authorization header injection from Secure Store-backed auth state.
- Request timeout defaults.
- Error normalization.
- Response schema validation with Zod for critical payloads.
- Token refresh orchestration if the existing API supports refresh tokens.
- Network status-aware retries for idempotent requests.

### Endpoint module pattern

Each endpoint module should expose typed functions:

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

Actual URL paths should be mapped after the existing API contract is provided.

### Error model

Normalize errors into a small app-level shape:

- `status`
- `code`
- `message`
- `userMessage`
- `isNetworkError`
- `isAuthError`
- `retryable`

This allows consistent error states across screens.

## 9. Caching Strategy

Use React Query as the primary cache for REST data.

### Cache categories

- Static or slow-changing data
  - event details
  - course maps
  - certificates
  - historical results
  - longer stale times
- Frequently changing data
  - live leaderboards
  - athlete tracking
  - live event status
  - short stale times and controlled polling
- User data
  - profile
  - my events
  - notification settings
  - invalidate after updates

### Query key design

Query keys should be centralized and structured:

```text
events.all
events.upcoming(filters)
events.live
events.detail(eventId)
events.courseMap(eventId)
leaderboards.event(eventId, filters)
athletes.search(eventId, query, filters)
athletes.detail(athleteId, eventId)
watchlist.all
results.event(eventId, filters)
results.athlete(athleteId)
certificates.detail(certificateId)
profile.me
```

### Polling guidelines

- Live event overview: moderate interval while focused.
- Leaderboard: moderate interval while focused.
- Athlete tracking detail: faster interval during live race windows.
- Disable or slow polling when:
  - screen is unfocused
  - app is backgrounded
  - network is poor
  - event is no longer live

## 10. Notification Strategy

Use Expo Notifications for device registration, permission handling, local notification behavior, and notification response routing.

### Notification use cases

- Watched athlete starts.
- Watched athlete reaches split.
- Watched athlete finishes.
- Event goes live.
- Result becomes available.
- Certificate becomes available.

### Permission flow

- Do not request permission on first launch.
- Ask contextually after the user adds an athlete to the watchlist or opens notification settings.
- Explain the value before showing the OS permission dialog.
- Store local prompt state to avoid repeated prompts.

### Push registration flow

1. User grants permission.
2. App obtains Expo push token.
3. App sends token to the existing REST API.
4. App stores registration state locally.
5. App refreshes registration when token, user, or device metadata changes.

### Notification routing

Notification payloads should include route-safe data:

- `type`
- `eventId`
- `athleteId`
- `certificateId`
- `resultId`

Notification handling should navigate through Expo Router and gracefully fallback to Home if a target is invalid or unavailable.

## 11. Offline Strategy

The app should be useful when connectivity is intermittent, especially at race venues.

### Offline principles

- Previously viewed events, leaderboards, athlete details, course maps, and results should remain visible from cache when possible.
- Users should be able to view and manage a local watchlist offline.
- Mutations should be queued only for low-risk actions where the API contract supports reconciliation.
- Live data should clearly show last updated timestamps.
- Offline states should be explicit but not disruptive.

### Offline behavior by feature

- Home
  - Show cached upcoming and live event summaries.
- Upcoming Events
  - Show cached list and an offline banner.
- Live Events
  - Show last cached state with stale indicator.
- Event Details
  - Show cached details and map if available.
- Leaderboard
  - Show cached leaderboard with last updated timestamp.
- Athlete Search
  - Search cached recent results where available; otherwise show offline unavailable state.
- Athlete Tracking
  - Show last known split, position, and timestamp.
- Course Maps
  - Show cached map metadata and previously loaded tiles where supported by the map provider.
- Watchlist
  - Fully available locally, sync changes when online.
- Athlete Login
  - Network required.
- My Events
  - Show cached data for authenticated athletes.
- Results
  - Show cached historical results.
- Certificates
  - Show cached certificate metadata; network may be required for fresh downloadable assets.

### Persistence

React Query cache persistence can be introduced if it can be done within the approved dependency set. If no approved persistence adapter is available without adding dependencies, persist only essential client state with Zustand and rely on in-memory React Query cache until the dependency policy is expanded.

## 12. Authentication Design

Athlete authentication should be isolated in the auth feature.

### Login form

- React Hook Form for form state.
- Zod for validation.
- Clear error states for invalid credentials, network errors, and server errors.
- Secure Store for tokens.
- Zustand auth store for bootstrapped session state.

### Session behavior

- Bootstrap auth state before rendering authenticated routes.
- Keep guest mode fully usable without login.
- On auth expiration, return athlete-only flows to login while preserving public context.
- Never expose raw tokens to screen components.

## 13. Tablet and Responsive Layout

The app should support phones and tablets with adaptive layout rules.

### Phone

- Tab-first navigation.
- Full-width lists.
- Map overlays as bottom sheets.
- Compact leaderboard rows.

### Tablet

- Max-width content columns for reading surfaces.
- Two-column event detail layout where useful.
- Persistent side panels for map plus athlete list where screen size allows.
- Larger map-first layouts for live tracking.

Responsive behavior should be derived from device dimensions and platform utilities, not separate tablet-only screens unless necessary.

## 14. Performance Strategy

- Use stable query keys and memoized selectors.
- Keep Zustand stores small and selector-driven.
- Prefer FlashList only if the dependency policy expands; otherwise use optimized `FlatList` with careful item layout and memoized rows.
- Avoid unnecessary navigation nesting.
- Load heavy map views only when routes are focused.
- Keep live polling scoped to focused screens.
- Use skeleton loading for perceived speed.
- Avoid rendering hidden expensive map overlays.

## 15. Data Validation Strategy

Use Zod at API boundaries for:

- Authentication responses.
- Event details.
- Leaderboard rows.
- Athlete tracking state.
- Certificate metadata.
- Profile data.

Validation should protect the app from malformed API responses while preserving graceful partial failure where appropriate.

## 16. Feature-by-Feature Data Ownership

| Feature          | Server state                 | Client state               | Notes                              |
| ---------------- | ---------------------------- | -------------------------- | ---------------------------------- |
| Home             | upcoming events, live events | recently viewed            | Guest-first                        |
| Upcoming Events  | event list                   | filters                    | Cacheable                          |
| Live Events      | live event summaries         | selected race context      | Poll while focused                 |
| Event Details    | event detail                 | none/minimal               | Deep-link target                   |
| Leaderboard      | leaderboard rows             | filters                    | Poll during live events            |
| Athlete Search   | search results               | recent searches            | Debounced REST search              |
| Athlete Tracking | athlete live data            | watchlist optimistic state | Fastest polling during active race |
| Course Maps      | map metadata                 | selected overlay           | Avoid direct DB access             |
| Watchlist        | optional remote watchlist    | local watchlist IDs        | Offline-first                      |
| Notifications    | preferences                  | permission prompt state    | Contextual opt-in                  |
| Athlete Login    | auth response                | session state              | Secure Store tokens                |
| My Events        | athlete events               | none/minimal               | Auth required                      |
| Results          | results                      | filters                    | Cache historical results           |
| Certificates     | certificate metadata         | none/minimal               | Auth or public depending API       |
| Profile          | profile                      | preferences                | Auth required                      |
| Settings         | notification preferences     | appearance, units          | Mixed server/client                |

## 17. Implementation Guardrails

- Do not add Firebase, Firestore, Cloudflare, KV, database, or backend SDK dependencies.
- Do not create API routes, server functions, workers, or backend services.
- Do not place Axios calls inside screen components.
- Do not store secrets or tokens outside Secure Store.
- Do not assume API URL paths until the API contract is available.
- Do not build screens until this architecture is approved.
- Keep all implementation TypeScript-first and route-driven through Expo Router.

## 18. Approval Checklist

Before implementation starts, confirm:

- REST API base URL and endpoint contract.
- Authentication response shape and token refresh behavior.
- Push notification registration endpoint and payload format.
- Event, athlete, leaderboard, result, certificate, and map schemas.
- Brand colors, logo assets, and typography preferences.
- Map provider requirements for iOS and Android.
- Certificate viewing/downloading requirements.
- Whether watchlist is guest-local, server-backed, or both.
- Whether React Query cache persistence may add a dependency if needed.
