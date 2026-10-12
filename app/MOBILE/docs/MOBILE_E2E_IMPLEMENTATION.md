# BERGMAN Mobile End-to-End Implementation

This document explains the full mobile data flow for:

- Upcoming events
- Athlete dashboard
- Live tracking
- Data fetching by function

It is written for the Expo React Native app and the Mobile API Worker.

## 1. Source of truth

### Base URL
- `https://api-mobile.bergmantri.com`

### Mobile API ownership
The mobile API owns:

- Authentication
- Athlete account
- Dashboard
- Registrations
- Watchlist
- Notifications
- Certificates
- Settings
- Profile

### Live tracking ownership
Public live race data is proxied internally to the Live Tracking Worker.

The mobile app must not call legacy Next.js API routes directly.

---

## 2. Screen flow

### Home screen
Shows:
- Upcoming events
- Current live event
- Cached recent events

### Event screen
Shows:
- Event details
- Rules and cutoff summaries
- Entry points into track and leaderboard views

### Live track screen
Shows:
- Live map
- Athlete search
- Watchlist athletes
- Live leaderboard
- Athlete detail cards

### Athlete dashboard
Shows:
- Athlete identity and club
- Upcoming race
- Recent results
- Certificates
- Watchlist
- Live race status when available

---

## 3. End-to-end request flow

### A. Upcoming events flow

1. `useEvents()` loads the event feed.
2. `useHomeFeed()` filters the result into:
   - `currentLive`
   - `upcoming`
   - `past`
3. Home UI renders the upcoming event cards.
4. Tapping an event opens the event detail route.

### B. Athlete dashboard flow

1. `useAthleteDashboard()` loads the authenticated athlete dashboard aggregate.
2. `useMobileProfile()` loads the authenticated athlete profile.
3. `useAthleteProfile(athleteId)` loads the deeper athlete aggregate.
4. `AthleteDashboardScreen` merges:
   - next race
   - recent results
   - certificates
   - watchlist
   - live race status
5. UI actions route to event detail, leaderboard, settings, or login.

### C. Live tracking flow

1. `useEvent(eventId)` loads the selected event metadata.
2. `useEventTracking(eventId)` loads live participants.
3. `useCourseMap(eventId)` loads the course index.
4. `useCourseGeometry(eventId)` resolves map geometry.
5. `useLeaderboard(eventId)` loads live leaderboard data while the event is live.
6. `useAthleteSearch(eventId, q, mode)` searches live participants or results.
7. `useAthleteDetail(eventId, params)` loads a single athlete’s live card.

---

## 4. Data fetching by function

### Home and upcoming events

| Function | Purpose | Repository call | Endpoint |
| --- | --- | --- | --- |
| `useEvents()` | Load event list | `repositories.events.getLiveEvents(signal)` | `GET /api/events` or live fallback `GET /api/live/events` |
| `useHomeFeed()` | Split live/upcoming/past events | Uses `useEvents()` | Same as above |

### Event detail

| Function | Purpose | Repository call | Endpoint |
| --- | --- | --- | --- |
| `useEvent(eventId)` | Load event detail | `repositories.events.getEventDetail(eventId, signal)` | `GET /api/events/{eventId}` |
| Fallback inside `useEvent()` | Load event from list if detail fails | `repositories.events.getLiveEvents(signal)` | `GET /api/events` or `GET /api/live/events` |
| `useEventTracking(eventId)` | Load live participant roster | `repositories.tracking.getParticipants(eventId, signal)` | `GET /api/live/participants/{eventId}?kvOnly=1` |
| `useEventCourseConfig(eventId)` | Load course config for the event | `repositories.course.getCourseConfig(eventId, signal)` | `GET /api/live/course-config?eventId={eventId}` or fallback `GET /api/live/config/{eventId}` |

### Athlete dashboard

| Function | Purpose | Repository call | Endpoint |
| --- | --- | --- | --- |
| `useAthleteDashboard()` | Main dashboard aggregate | `repositories.mobile.getAthleteDashboard()` | `GET /api/dashboard` |
| `useMobileProfile()` | Authenticated profile | `repositories.profile.getProfile()` | `GET /api/athletes/profile` |
| `useAthleteProfile(athleteId)` | Detailed athlete aggregate | `repositories.mobile.getAthleteProfile(athleteId)` | Mobile API aggregate endpoint |
| `useTrainingDashboard()` | Training summary | `repositories.mobile.getTraining()` | Mobile API training endpoint |
| `repositories.profile.getRegistrations()` | Registration list for upcoming races | Called directly in dashboard screen | `GET /api/athletes/registrations` |

### Rankings and leaderboard

| Function | Purpose | Repository call | Endpoint |
| --- | --- | --- | --- |
| `useLeaderboard(eventId, filters)` | Live leaderboard while event is active | `repositories.leaderboard.getLeaderboard(eventId, filters, signal)` | `GET /api/live/leaderboard/{eventId}` |
| `useLeaderboard(..., { isLive: false })` | Completed-event leaderboard | `repositories.results.getEventResults(eventId, signal)` | Results endpoint |
| `useAthleteRankings(filters)` | Athlete ranking lists | `repositories.mobile.getAthleteRankings(filters)` | Mobile API rankings endpoint |
| `useClubRankings(filters)` | Club ranking lists | `repositories.mobile.getClubRankings(filters)` | Mobile API rankings endpoint |

### Live athlete search and detail

| Function | Purpose | Repository call | Endpoint |
| --- | --- | --- | --- |
| `useAthleteSearch(eventId, q, mode)` | Search live participants | `repositories.athlete.search(eventId, q, mode, signal)` | Live participant search endpoint |
| `useAthleteSearch(..., source='results')` | Search completed event results | `repositories.results.getEventResults(eventId, signal)` | Results endpoint |
| `useAthleteDetail(eventId, params)` | Load one athlete card or modal | `repositories.athlete.getDetail(eventId, params, signal)` | Live athlete detail endpoint |

### Course and map data

| Function | Purpose | Repository call | Endpoint |
| --- | --- | --- | --- |
| `useCourseMap(eventId)` | Load course index | `repositories.course.getCourseIndex(eventId, signal)` | `GET /api/live/course-index/{eventId}` |
| `useCourseGeometry(eventId)` | Resolve geometry for live map | `repositories.course.getCourseConfig(eventId, signal)` | `GET /api/live/course-config` or fallback `GET /api/live/config/{eventId}` |

---

## 5. Screen-by-screen implementation notes

### Home screen
Use the home feed for a fast guest-first landing page.

Recommended behavior:
- Show live event first when available
- Show upcoming events below it
- Keep cached data visible offline when possible

Data path:
- `HomeScreen` → `useHomeFeed()` → `useEvents()` → `repositories.events.getLiveEvents()`

### Upcoming events card
The upcoming event card should render:
- Event name
- Date
- Venue
- Status badge
- CTA to open event detail

Data path:
- `useEvents()` data filtered to `upcoming` or `notStarted`

### Athlete dashboard
The athlete dashboard is the authenticated account landing page.

It merges data from:
- dashboard aggregate
- profile aggregate
- registration list
- certificate list
- live race status

Data path:
- `AthleteDashboardScreen` → `useAthleteDashboard()`
- `AthleteDashboardScreen` → `useMobileProfile()`
- `AthleteDashboardScreen` → `useAthleteProfile(user.uid)`
- `AthleteDashboardScreen` → `repositories.profile.getRegistrations()`

UI sections:
- Hero identity card
- Total races and BEL points
- Upcoming race card
- Rules/cutoff summary
- Recent results
- Certificates
- Watchlist
- Live status card

### Live tracking screen
The live tracking screen should only show live race UI when the event is active.

Data path:
- `LiveTrackScreen` → `useEvent(eventId)`
- `LiveTrackScreen` → `useEventTracking(eventId)`
- `LiveTrackScreen` → `useCourseMap(eventId)`
- `LiveTrackScreen` → `useCourseGeometry(eventId)`
- `LiveTrackScreen` → `useLeaderboard(eventId, filters, options)`
- `LiveTrackScreen` → `useAthleteSearch(eventId, q, mode)`
- `LiveTrackScreen` → `useAthleteDetail(eventId, params)`

Poll timing from the hooks:
- Participants: every 5 seconds while focused
- Leaderboard: every 5 to 10 seconds depending on screen and query state
- Athlete detail: every 5 seconds while the athlete panel is open
- Search: debounced by 200 ms

### Event track screen
The event track screen combines:
- live map
- watchlist roster
- results fallback when the event is finished
- event metadata

Data path:
- `EventTrackScreen` → `useEventTracking(id)`
- `EventTrackScreen` → `useCourseMap(id)`
- `EventTrackScreen` → `useCourseGeometry(id)`
- `EventTrackScreen` → `useLeaderboard(id, { gender: 'All' }, { focused: true, isLive: eventQuery.event?.status === 'live' })`

---

## 6. Function-to-endpoint cheat sheet

### Events
- `repositories.events.getLiveEvents()` → event feed
- `repositories.events.getEventDetail(eventId)` → event detail
- `repositories.events.getEventTracking(eventId)` → live event tracking summary

### Tracking
- `repositories.tracking.getParticipants(eventId)` → live participant roster
- `repositories.tracking.getAthletes(eventId, categoryId)` → filtered participant roster
- `repositories.tracking.getWorkerLeaderboard(eventId)` → live leaderboard snapshot
- `repositories.tracking.getTimings(eventId)` → timing config
- `repositories.tracking.getReplay(eventId)` → replay feed
- `repositories.tracking.getProviderConfig(eventId)` → provider status/config
- `repositories.tracking.getMonitoring(eventId)` → monitoring data

### Leaderboard
- `repositories.leaderboard.getLeaderboard(eventId, filters)` → live leaderboard rows

### Course
- `repositories.course.getCourseIndex(eventId)` → course index and timing config
- `repositories.course.getCourseConfig(eventId)` → course geometry config

### Mobile account
- `repositories.mobile.getAthleteDashboard()` → dashboard aggregate
- `repositories.mobile.getAthleteProfile(athleteId)` → athlete aggregate
- `repositories.mobile.getAthleteRankings(filters)` → athlete ranking list
- `repositories.mobile.getClubRankings(filters)` → club ranking list
- `repositories.mobile.getTraining()` → training dashboard

### Profile
- `repositories.profile.getProfile()` → profile record
- `repositories.profile.getRegistrations()` → registrations

---

## 7. Recommended implementation order

1. Home screen and event feed
2. Event detail screen
3. Athlete dashboard aggregate
4. Live tracking screen
5. Course geometry and map rendering
6. Athlete search and athlete detail
7. Rankings and completed-event fallback
8. Offline cache states and stale indicators

---

## 8. Required rules

- Use `EXPO_PUBLIC_MOBILE_API_URL` for the mobile API base.
- Do not hardcode legacy web API routes.
- Keep live-tracking requests behind event status checks.
- Use completed-event results instead of live endpoints after the race finishes.
- Keep public live race data behind the Live Tracking Worker.

---

## 9. Related docs

- [API endpoints](API_ENDPOINTS.md)
- [Mobile architecture](mobile-architecture.md)
- [Live tracking integration](LIVE_TRACKING_INTEGRATION.md)
- [Navigation](NAVIGATION.md)
