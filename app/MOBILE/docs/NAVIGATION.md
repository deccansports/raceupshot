# BERGMAN Race — Navigation

Status: Draft for approval
Scope: Official native mobile application only

Navigation is implemented with Expo Router using file-system routing. The app uses route groups to separate public guest flows, authenticated athlete flows, shared modal flows, and onboarding/auth flows. This is a proposed route model; screen implementation waits for approval.

## 1. Route Groups

```text
app/
  _layout.tsx                 # Root layout: providers, theme, query client, auth + notification bootstrap, deep links
  (tabs)/
    _layout.tsx               # Tab navigator
    index.tsx                 # Home
    events.tsx                # Events
    watchlist.tsx             # Watchlist
    results.tsx               # Results
    profile.tsx               # Profile / Athlete Hub entry
  events/
    [eventId]/
      _layout.tsx             # Event stack layout
      index.tsx               # Event Details
      leaderboard.tsx         # Leaderboard
      athletes.tsx            # Athlete Search (event-scoped)
      map.tsx                 # Course Map
  athletes/
    [athleteId].tsx           # Athlete Detail + tracking timeline
  auth/
    login.tsx                 # Athlete Login
  settings/
    index.tsx                 # Settings
    notifications.tsx         # Notification settings
    appearance.tsx            # Appearance settings
  certificates/
    [certificateId].tsx       # Certificate viewer
  modals/
    search.tsx                # Global search (modal)
    filters.tsx               # Filters (modal)
```

## 2. Navigation Hierarchy

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

## 3. Access Control

- Guest mode is fully usable: Home, Events, Live Tracking, Leaderboards, Athlete Search, Athlete Details, Course Maps, and Watchlist require no login.
- Authenticated-only routes (My Events, personal Results/Rankings, Certificates tied to the athlete, Profile settings) require a bootstrapped session.
- On auth expiration, only athlete-only flows return to `auth/login`; public context is preserved.

## 4. Deep Links

Deep links MUST support:

- Event detail: `bergmanrace://events/:eventId`
- Athlete detail: `bergmanrace://athletes/:athleteId`
- Certificate: `bergmanrace://certificates/:certificateId`
- Live event: `bergmanrace://events/:eventId/live`

Push notification payloads use the same route targets. Notification handling navigates through Expo Router and gracefully falls back to Home if a target is invalid or unavailable.

## 5. Modal and Bottom Sheet Patterns

- Global search and filters are presented as modal routes under `modals/`.
- Map overlays and athlete lists are presented as bottom sheets on phones and as side panels on tablets (see [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md), tablet layout).

## 6. Tab Behavior

- Preserve tab state and last-selected event context where useful (client state; see [STATE_MANAGEMENT.md](STATE_MANAGEMENT.md)).
- Live polling is scoped to the focused tab/screen only.

## 7. Transitions

- Use Reanimated and Gesture Handler for press feedback, sheet gestures, and map overlay transitions.
- Customize tab and stack transitions only where Expo Router allows and where it improves perceived performance.
- Respect reduced-motion settings.
