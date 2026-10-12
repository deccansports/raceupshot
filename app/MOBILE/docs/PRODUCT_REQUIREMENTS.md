# BERGMAN Race — Product Requirements

Status: Draft for approval
Scope: Official native mobile application only

This document defines functional and non-functional requirements for each module. Actual API paths, payload shapes, and asset specifics are confirmed during the approval gate (see the Approval Checklist in [mobile-architecture.md](mobile-architecture.md)).

## 1. Requirement Conventions

- MUST: hard requirement for the first store release.
- SHOULD: strong preference; include unless it blocks the release.
- MAY: optional or future enhancement.

Every data-driven screen MUST support four canonical states: loading, empty, error, and content. Live screens MUST additionally show a last-updated indicator and a stale state.

## 2. Core Modules

### 2.1 Home

- MUST show cached and live summaries of upcoming and live events for guests.
- MUST surface live events prominently while any event is live.
- SHOULD show recently viewed events.
- MUST be fully usable in guest mode.

### 2.2 Events

- MUST list upcoming events with premium cards.
- MUST support filtering (for example by date, discipline, and status) and search entry.
- SHOULD paginate long lists and support pull-to-refresh.
- MUST cache lists for offline viewing with an offline banner.

### 2.3 Live Tracking

- MUST show live event status and summaries with polling while focused.
- MUST show last-updated timestamps and a clear stale indicator.
- MUST slow or disable polling when the screen is unfocused, the app is backgrounded, the network is poor, or the event is no longer live.

### 2.4 Leaderboards

- MUST show ranked leaderboard rows for an event with filters (for example category and age group).
- MUST poll at a moderate interval during live events while focused.
- MUST cache the last known leaderboard with a last-updated timestamp for offline viewing.

### 2.5 Athlete Search

- MUST support debounced REST search of athletes, scoped by event where applicable.
- SHOULD show recent searches as client state.
- MUST show an offline-unavailable state when search cannot run offline.

### 2.6 Athlete Details

- MUST show athlete profile summary, tracking timeline, splits, and status.
- MUST show last known split, position, and timestamp when offline.
- MUST allow adding/removing the athlete from the watchlist.
- Tracking detail MUST poll fastest during active race windows and back off otherwise.

### 2.7 Course Maps

- MUST render the course map with split markers using React Native Maps.
- SHOULD show cached map metadata and previously loaded tiles where the provider supports it.
- MUST load heavy map views only when the route is focused.
- MUST NOT access any database directly; map data comes from REST only.

### 2.8 Watchlist

- MUST maintain a local watchlist of athlete IDs available offline.
- SHOULD sync with a server-backed watchlist when the API supports it (guest-local vs server-backed is confirmed at approval).
- MUST support optimistic add/remove with micro-interactions.

### 2.9 Notifications

- MUST use Expo Notifications for permissions, registration, and response routing.
- MUST NOT request permission on first launch; ask contextually (for example after adding an athlete to the watchlist).
- MUST register the Expo push token with the existing REST API after permission is granted.
- MUST route notification payloads through Expo Router with a safe fallback to Home.
- Notification use cases: watched athlete starts, reaches a split, finishes; event goes live; result available; certificate available.

### 2.10 Athlete Hub (My Events, Results, Rankings, Certificates, Profile)

- MUST require authentication for personal data.
- MUST show My Events, Results, Rankings, Profile, and Certificates for the authenticated athlete.
- MUST cache athlete data for offline viewing where it is not sensitive.
- Certificates MAY require network for fresh downloadable assets; metadata SHOULD be cached.

### 2.11 Settings

- MUST provide appearance (light/dark/system), units, and notification preferences.
- MUST persist appearance and units with Zustand persistence.
- Notification preferences are mixed server/client: mirror locally and invalidate server data after updates.

### 2.12 Authentication

- MUST provide an athlete login form (React Hook Form + Zod).
- MUST store tokens only in Expo Secure Store; never expose raw tokens to screens.
- MUST bootstrap auth state before rendering authenticated routes.
- MUST keep guest mode usable and return only athlete flows to login on expiration.

## 3. Non-Functional Requirements

### 3.1 Performance

- MUST use optimized lists, stable query keys, and memoized rows/selectors.
- MUST support lazy loading, image caching, pagination, and request cancellation.
- SHOULD support background refresh where appropriate.
- MUST keep live polling scoped to focused screens.

### 3.2 Offline and Reliability

- MUST keep previously viewed data visible from cache where possible.
- MUST show explicit but non-disruptive offline states with last-updated indicators.
- MAY queue only low-risk mutations where the API contract supports reconciliation.

### 3.3 Accessibility

- MUST maintain WCAG-friendly contrast for text and controls.
- MUST support dynamic type and provide semantic labels for map controls, tracking status, ranks, and certificates.
- MUST use touch targets of at least 44 x 44 points.
- MUST NOT rely on color alone to communicate status.

### 3.4 Internationalization and Units

- SHOULD centralize formatting for dates, times, distances, and paces.
- MUST support unit preference (metric/imperial) via client state.

### 3.5 Security and Privacy

- MUST store only tokens and token metadata in Secure Store.
- MUST NOT persist full profile data or large payloads in Secure Store.
- MUST inject the Authorization header from Secure Store-backed auth state in the API client only.

## 4. Data Ownership Summary

The authoritative feature-by-feature data ownership matrix (server state, client state, and notes) is maintained in [mobile-architecture.md](mobile-architecture.md), section 16, and mirrored in [STATE_MANAGEMENT.md](STATE_MANAGEMENT.md).

## 5. Acceptance Criteria (Release)

- All MUST requirements implemented and manually verified on iOS and Android.
- All data screens implement loading/empty/error/content states.
- Live screens implement polling lifecycle, stale indicators, and last-updated timestamps.
- Accessibility checks pass for contrast, dynamic type, touch targets, and labels.
- No secrets or tokens stored outside Secure Store; no API calls inside screen components.
