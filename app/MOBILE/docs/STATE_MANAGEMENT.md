# BERGMAN Race — State Management

Status: Draft for approval
Scope: Official native mobile application only

Use React Query for server state and Zustand for client state. Never duplicate state between the two: server data lives in React Query; UI/session/preferences live in Zustand.

## 1. Responsibilities Split

### 1.1 React Query (server state)

- Events, live event data, event details
- Leaderboards
- Athlete search and athlete details
- Course maps
- Results
- Certificates
- Profile data
- Notification preference data fetched from REST APIs

### 1.2 Zustand (client state)

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

### 1.3 Secure storage

Expo Secure Store holds sensitive values only:

- access token
- refresh token, if provided by the existing API
- token expiration metadata

Do not store full profile data or large API payloads in Secure Store.

## 2. Store Locations

- Global Zustand stores live in `src/store/` (for example `app.store.ts`, `preferences.store.ts`, and an auth session store bootstrapped from Secure Store).
- Feature-local client state (only when needed) lives in the feature's `store.ts`, for example `features/watchlist/store.ts` and `features/auth/store.ts`.
- React Query hooks live in each feature's `hooks/` directory.

## 3. Query Key Design

Query keys are centralized in `src/services/api/queryKeys.ts` and structured:

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

Keys are stable and derived from typed inputs so caching, invalidation, and refetching are predictable.

## 4. Caching Strategy

React Query is the primary cache for REST data.

### 4.1 Cache categories

- Static or slow-changing data (longer stale times):
  - event details, course maps, certificates, historical results
- Frequently changing data (short stale times, controlled polling):
  - live leaderboards, athlete tracking, live event status
- User data (invalidate after updates):
  - profile, my events, notification settings

### 4.2 Polling guidelines

- Live event overview: moderate interval while focused.
- Leaderboard: moderate interval while focused.
- Athlete tracking detail: faster interval during live race windows.
- Disable or slow polling when:
  - screen is unfocused
  - app is backgrounded
  - network is poor
  - event is no longer live

### 4.3 Persistence

React Query cache persistence may be introduced if it fits within the approved dependency set. If no approved persistence adapter is available without adding dependencies, persist only essential client state with Zustand and rely on in-memory React Query cache until the dependency policy expands.

## 5. Optimistic Updates

- Watchlist add/remove uses optimistic client state with rollback on failure.
- Other mutations remain server-authoritative and invalidate related queries on success.

## 6. Offline Behavior

- Previously fetched queries remain visible from cache where possible.
- Live screens show last-updated timestamps and a stale indicator.
- The watchlist is fully usable offline via Zustand and syncs when online (if server-backed watchlist is confirmed at approval).

## 7. Feature-by-Feature Data Ownership

| Feature          | Server state                 | Client state               | Notes                              |
| ---------------- | ---------------------------- | -------------------------- | ---------------------------------- |
| Home             | upcoming events, live events | recently viewed            | Guest-first                        |
| Upcoming Events  | event list                   | filters                    | Cacheable                          |
| Live Events      | live event summaries         | selected race context      | Poll while focused                 |
| Event Details    | event detail                 | none/minimal               | Deep-link target                   |
| Leaderboard      | leaderboard rows             | filters                    | Poll during live events            |
| Athlete Search   | search results               | recent searches            | Debounced REST search              |
| Athlete Tracking | athlete live data            | watchlist optimistic state | Fastest polling during active race |
| Course Maps      | map metadata                 | selected overlay           | No direct DB access                |
| Watchlist        | optional remote watchlist    | local watchlist IDs        | Offline-first                      |
| Notifications    | preferences                  | permission prompt state    | Contextual opt-in                  |
| Athlete Login    | auth response                | session state              | Secure Store tokens                |
| My Events        | athlete events               | none/minimal               | Auth required                      |
| Results          | results                      | filters                    | Cache historical results           |
| Certificates     | certificate metadata         | none/minimal               | Auth or public depending on API    |
| Profile          | profile                      | preferences                | Auth required                      |
| Settings         | notification preferences     | appearance, units          | Mixed server/client                |

## 8. Anti-Patterns to Avoid

- Copying React Query data into Zustand.
- Storing server payloads in Secure Store.
- Polling on unfocused or backgrounded screens.
- Deriving state that can be computed from existing server/client sources.
