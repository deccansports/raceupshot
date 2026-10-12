# BERGMAN Web Application — Architecture Audit

Source of truth: `deccansports/bergman-app` (Next.js App Router). This audit is
based on a direct read of that codebase and drives the mobile app's integration.
Nothing here is invented; items not present are marked **not found**.

> ⚠️ **Critical finding (please read first).** The web app authenticates with
> **Firebase Authentication** (email-OTP → Firebase **custom token** →
> `signInWithCustomToken`, then Firebase **ID tokens** as the session token). It
> does **not** use Django **SimpleJWT**, there is **no access/refresh JWT pair**,
> and there is **no mobile-OTP login** endpoint (WhatsApp is only a secondary
> delivery channel for the same email OTP). This contradicts the mobile
> instructions ("reuse SimpleJWT", "mobile OTP", "do not use Firebase Auth").
> See §2 and §9 for the implications and options. Milestone 5 (Live Tracking)
> does not depend on this and proceeds unaffected (spectator tracking is public).

---

## 1. Project Structure

**Stack:** Next.js (App Router) + React + TypeScript, Firebase (Auth, Firestore,
Storage, Admin SDK, Functions), Cloudflare (Worker + KV + R2 + Durable Object),
Tailwind/Radix UI, React Hook Form + Zod, Axios, Leaflet/React-Leaflet + Google
Maps, Razorpay/Stripe, Recharts. Data provider for timing: **Feibot**.

Top-level `src/`:

- `app/` — routes + `app/api/**` (the REST backend, as Next.js route handlers).
- `components/` — UI (incl. `components/live-tracking/**`, `components/auth/**`).
- `context/` — `AuthContext`, `ClientAuthManager`, cart context.
- `firebase/` — client Firebase init + real-time hooks (`useCollection`, `useDoc`).
- `hooks/` — small UI hooks (`useCountdown`, `use-mobile`, `use-toast`).
- `lib/` — the bulk of business logic:
  - `lib/actions/**` — **server actions** (the de-facto service layer).
  - `lib/live-tracking/**`, `lib/liveTracking*.ts`, `lib/feibot-integration/**` — tracking.
  - `lib/cloudflare/kv.ts` — Cloudflare KV REST client (hot read layer).
  - `lib/dataLayerOptimized.ts` — KV-first data access helpers.
  - `lib/eventDataPaths.ts` — Firestore collection + KV key constants.
  - `lib/auth/**`, `lib/apiAuth.ts`, `lib/api/authenticatedFetch.ts`, `lib/api.ts`.
  - `lib/types/**` — domain models. `lib/schemas.ts` — Zod schemas.
- `functions/` — Firebase Cloud Functions (duplicate auth/email config).
- `cloudflare/live-tracking-worker/**` — the edge Worker (KV/R2/DO).

**Architecture pattern:** There is **no classic repository/ORM layer**. Firestore
is the system of record; **Cloudflare KV is the hot read layer** for public/
mobile-scale data; the "service layer" is server actions (`lib/actions/*`) plus
KV-first helpers (`dataLayerOptimized.ts`). The mobile app will add the explicit
Repository layer that the web omits.

Base hosts: web app `https://bergmantri.com`; mobile API worker
`https://api-mobile.bergmantri.com`.

---

## 2. Authentication

**Model: Firebase Authentication (not SimpleJWT).**

### Email OTP — request

- `POST /api/send-email-otp` — body `{ email: string, name?: string }`.
- Server stores a hashed OTP in Firestore `otp_attempts` (10-min TTL), emails it
  (Brevo/BergTechno), and, if the user has a `mobile`, also sends the **same** OTP
  via WhatsApp (AiSensy).
- Response `{ success, message, maskedMobile, whatsappSent }`.

### Email OTP — verify (login)

- `POST /api/verify-email-otp` — body `{ email, otp (6 digits) }`.
- Response `{ success, message, token, isNewUser }` where `token` is a **Firebase
  custom token** (`adminAuth.createCustomToken(uid)`).
- Client then calls `signInWithCustomToken(auth, token)` (`AuthContext.tsx`).

### Session, refresh, logout, restore

- Session token = **Firebase ID token** via `user.getIdToken()`; refreshed
  automatically by the Firebase SDK (force refresh `getIdToken(true)` on 401/403
  in `lib/api/authenticatedFetch.ts`). **No `/api/refresh` and no refresh-token field.**
- Logout: `signOut(auth)` (Firebase SDK); no server revocation endpoint.
- Session restore / auto-login: `onAuthStateChanged` in `AuthContext.tsx` → fetch
  Firestore `users` profile.
- Protected routes: **no `middleware.ts`**; guarded client-side by
  `ClientAuthManager` (public route allow-list + redirects) and `ClientAuthGuard`
  (role-based). Public auth routes: `/login`, `/signup`, `/forgot-password`,
  `/update-password`, `/verify-email`, etc.

### Authorization on requests

- Header `Authorization: Bearer <firebase-id-token>`; server verifies with
  `adminAuth.verifyIdToken`. Wrapper: `lib/api/authenticatedFetch.ts`.
- Separate machine-to-machine auth for public APIs: SHA-256 hashed **API keys** in
  Firestore `apiKeys`, also sent as `Authorization: Bearer <apiKey>` (`lib/apiAuth.ts`).

### Mobile OTP login — **not found**

No `/api/send-mobile-otp` / `/api/verify-mobile-otp` / phone-keyed login. WhatsApp
is a delivery channel for the email-keyed OTP only.

### SimpleJWT — **not found** anywhere in the repo.

### Key files

`context/AuthContext.tsx`, `context/ClientAuthManager.tsx`,
`components/auth/AuthForm.tsx`, `components/auth/ClientAuthGuard.tsx`,
`app/api/send-email-otp/route.ts`, `app/api/verify-email-otp/route.ts`,
`lib/auth/otpService.ts` (Firestore `otp_attempts`, SHA-256, 10-min TTL),
`lib/auth/brevoService.ts`, `lib/auth/aisensyService.ts`, `lib/apiAuth.ts`,
`lib/api/authenticatedFetch.ts`, `lib/firebase.ts`, `lib/firebaseAdmin.ts`.

### Reuse guidance

- **Reuse identical:** the email-OTP request/verify **contract** shape
  (`/api/send-email-otp`, `/api/verify-email-otp`).
- **Cannot reuse as specified:** "SimpleJWT + refresh token + mobile OTP" — these
  do not exist in the web app. The real token is a Firebase custom token → Firebase
  ID token.
- **Decision required (see §9):** either (a) adopt Firebase Auth on mobile
  (contradicts "no Firebase Auth"), or (b) the backend team exposes a
  SimpleJWT/mobile-OTP layer for mobile (does not exist yet). The mobile app
  already ships an OTP + token abstraction (`authService`/`authRepository`) that
  can target whichever the backend provides by filling route constants.

---

## 3. Firestore

**Database:** named DB `bmdatabase` (Admin), client prefers
`NEXT_PUBLIC_FIREBASE_DATABASE_ID`. `firestore.indexes.json` is **empty**.

### Top-level collections (selected, mobile-relevant)

| Collection                                       | Purpose                                 | Key fields                                                                                   |
| ------------------------------------------------ | --------------------------------------- | -------------------------------------------------------------------------------------------- |
| `users`                                          | Athlete/club/volunteer/admin profiles   | `uid,email,name,mobile,clubId,role,upcomingEvents`                                           |
| `events`                                         | Canonical event docs                    | `eventName,eventDate,customSlug,liveTrackingHub,ticketDefinitions`                           |
| `eventCalendar`                                  | Legacy calendar mirror of events        | same as events                                                                               |
| `raceResults`                                    | Final/historical results (flat)         | `bibNumber,name,chipTime,status,raceYear,eventId,athleteUid,swim/bike/run,oRank/gRank/cRank` |
| `clubs`                                          | Training clubs                          | `name,ownerUid,country,city`                                                                 |
| `announcements`                                  | Site announcements / tickers (≈ "news") | `title,message,type,isActive,startDate,endDate`                                              |
| `cms_content`                                    | CMS pages/homepage slider/footer        | docs `static_pages`,`homepage`,`footer`                                                      |
| `apiKeys`                                        | Public/mobile API keys (hashed)         | `keyHash,userId,prefix`                                                                      |
| `coupons`,`announcements`,`templates`,`settings` | config/ops                              | —                                                                                            |

### `events/{eventId}` subcollections

`participants` (+ `loopLogs`), `ticketDefinitions` (tickets incl. `courseMaps`
with swim/bike/run GPX URLs + splits), `sponsors`, `inventory`, `bibAssignments`,
`liveAthletes`, `liveCameras`, plus live-tracking subtrees defined in
`lib/eventDataPaths.ts`: `registrations, timingParticipants, timingReads, splits,
timingPoints, devices, broadcast, liveTracking, providerParticipants`.

### Not Firestore collections

- **News** → `announcements` + CMS pages (`footerCategory: 'News'`).
- **Gallery** → third-party **Split Second Pix** REST (`/api/race-photos`).
- **Certificates** → generated on demand (PDF), no collection.
- **Athletes** → `users` + `raceResults` (no standalone `athletes`).
- **Contests/Races** → Feibot/KV config + `RaceCategory` type (no Firestore collection).
- **Notifications** → templates + email/WhatsApp (no `notifications` collection).

### Data-source split

Firestore = system of record. **Cloudflare KV = hot read layer** (`calendar:snapshot`,
`event:{id}:participants:index`, `results:{eventId}`, `rankings:*`, `live:event:{id}:*`).
Gallery = third-party REST. Live tracking = Feibot → KV.

---

## 4. Live Tracking (mobile Milestone 5 source of truth)

**Architecture:** Feibot provider → (Cloudflare Worker + `live-timing-worker`) →
**Cloudflare KV** → Next.js `/api/live/*` + `/api/events/[id]/tracking` → web UI.
Public spectator endpoints require **no user auth**.

### Cloudflare Worker (`cloudflare/live-tracking-worker`)

- Host/route: `api-mobile.bergmantri.com` (mobile worker; API paths live under /api/*). Bindings: KV `BERGMAN_KV`,
  R2 `bergman-tracking`, DO `LIVE_RACE_STATE`. Responses `cache-control: no-store`.
- Public GETs: `/v1/events/:id/overview`, `/athletes`, `/leaderboard?mode&limit`,
  `/timings`, `/replay`, `/monitoring`. Query `categoryId`, `includeEmpty`.
- KV keys: `live:event:{id}:athletes`, `...:athlete:{bib}`, `...:leaderboard[:{mode}:{limit}]`,
  `...:overview`, `...:timingConfiguration`, `...:course:index`, `...:participant:index`.
- Feibot HMAC signing (`lib/signing.ts`): `METHOD+path+timestamp+sortedQuery+body`;
  headers `X-Feibot-Access-Key/-Timestamp/-Signature`.

### Next.js live endpoints (what the mobile app should call)

| Endpoint                                        | Params                                             | Response                                                                                                     | Poll               |
| ----------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------ |
| `GET /api/live/events`                          | —                                                  | `{ success, events: [{ id,name,date,customSlug,status,isUpcoming }] }`                                       | —                  |
| `GET /api/events/[eventId]/tracking`            | —                                                  | merged live+index participants (primary live feed)                                                           | **12s**            |
| `GET /api/live/leaderboard/[eventId]`           | `contest,ageGroup,gender(=All),limit(=100,max500)` | `{ success, athletes[], count, total, source:'kv', timestamp }`                                              | **2s** (web)       |
| `GET /api/live/athlete-master-search/[eventId]` | `q, mode=bib\|name\|email, kvOnly=1`               | `{ success, matches[], totalIndex, diagnostics }`                                                            | **200ms** debounce |
| `GET /api/live/athlete-modal/[eventId]`         | one of `bib\|providerUuid\|athleteUid\|bookingId`  | `{ success, athlete, contestContext{splits,timingPoints,ageGroups,legs}, timingConfiguration, courseIndex }` | **5s**             |
| `GET /api/live/course-index/[eventId]`          | —                                                  | `{ timingConfiguration, courseIndex }`                                                                       | 60s (config)       |
| `GET /api/live/course-config?eventId=`          | `eventId`                                          | Firestore ticket `courseMaps` (swim/bike/run GPX URLs + splits)                                              | 1h                 |
| `GET /api/live/participants/[eventId]`          | `kvOnly?`                                          | `{ success, participants[], count }`                                                                         | —                  |

### Leaderboard row shape (`/api/live/leaderboard`)

`{ rank, athleteId, name, bib, bibNumber, contest, ageGroup, gender, currentLeg,
gap, deltaTime, status, speed, pace, distanceCovered, distanceRemaining, eta,
lastUpdated }`. Filtering is contest/ageGroup/gender (no `mode`).

### Athlete detail derived fields

`currentLegName, currentSplitName, currentCheckpoint, distanceCoveredKm,
distanceRemainingKm, timingStarted`; ranks `overallRank, contestRank, genderRank,
ageGroupRank` (written by `live-timing-worker`). Splits from `contestContext.splits`
/ `LiveAthlete.splits`. GPS: `LiveAthlete.predictedLocation`/`lat`/`lng`
(`/api/live/athlete` is **mock** dev data — do not rely on it).

### Models (file paths in web repo)

`Split`, `LiveAthlete`, `RaceResult`, `RankedAthlete` — `lib/types/results.ts`.
`ResolvedTimingPoint`, `ResolvedContestTiming`, `ResolvedTimingConfiguration` —
`lib/timingConfiguration.ts`. `CourseIndex(Contest)` — `lib/courseIndex.ts`.
`SplitIndex` — `lib/splitIndex.ts`. `LiveTrackingTimingPoint`, `RaceCategory`,
`LiveTrackingHubConfig` — `lib/types/event.ts`. Feibot `Contest/Split/ContestStatus`
— `lib/feibot-integration/types.ts`. No standalone `RaceStatus` type; status is a
string on athletes/events (event `status` defaults `'upcoming'`).

### Intervals & caching (from web code)

Tracking feed 12s; leaderboard 2s (web) / config `leaderboardEverySeconds` 5|10|30;
athlete modal 5s; timing config 60s; replay 45s; search debounce 200ms; Next.js KV
read cache 15s (non-live), live KV keys uncached; provider results cache 30s; map
config effectively long-lived.

---

## 5. BERGMAN Backend (REST endpoints)

Backend = Next.js route handlers under `app/api/**` (there is no separate Django
service). Public/mobile APIs authenticate with an **API key** (`Authorization:
Bearer <apiKey>`), verified against Firestore `apiKeys`.

| Method | Path                                        | Auth    | Request                         | Response                                                            |
| ------ | ------------------------------------------- | ------- | ------------------------------- | ------------------------------------------------------------------- |
| GET    | `/api/live/events`                          | none    | —                               | `{ success, events:[{id,name,date,customSlug,status,isUpcoming}] }` |
| GET    | `/api/events/[eventId]/tracking`            | none    | —                               | merged live participants                                            |
| GET    | `/api/live/leaderboard/[eventId]`           | none    | `contest,ageGroup,gender,limit` | `{ success, athletes[] }`                                           |
| GET    | `/api/live/athlete-master-search/[eventId]` | none    | `q,mode,kvOnly`                 | `{ success, matches[] }`                                            |
| GET    | `/api/live/athlete-modal/[eventId]`         | none    | `bib\|bookingId\|...`           | `{ success, athlete, contestContext, ... }`                         |
| GET    | `/api/live/course-config`                   | none    | `eventId`                       | course maps / GPX                                                   |
| GET    | `/api/athlete-journey`                      | none    | `eventId,bibNumber`             | rich pre/post-race payload                                          |
| GET    | `/api/dashboard`                            | none    | `mobile`                        | `AthleteTierStats` + recent results (from KV)                       |
| GET    | `/api/race-photos`                          | none    | `bib_number,event_id?`          | Split Second Pix gallery                                            |
| POST   | `/api/sync-user-profile`                    | —       | `{ userId }`                    | sync result                                                         |
| POST   | `/api/admin/download-certificate`           | admin   | `{ athlete, eventName, ... }`   | PDF                                                                 |
| GET    | `/api/invoice/[bookingId]`                  | —       | path id                         | PDF                                                                 |

Public **final results** and **athlete rankings** have no dedicated JSON route —
they are exposed via server actions (`getPublicFinalResultsAction`,
`getAthleteRankingData`) reading KV `results:{eventId}` / `rankings:athletes:{year}`.
Errors: `400` invalid input, `401/403` unauthorized (missing/invalid Bearer),
`404` not found, `500` server. Envelopes use `{ success, ... }` / `{ success:false, message }`.

---

## 6. Types (shared domain models — from `lib/types/**`)

- **Event:** `EventCalendarEntry` (`event.ts`): `id, eventName, eventDate,
customSlug, ticketDefinitions[], sponsors[], liveTrackingHub, venue, courseDetails, stats`.
- **Sponsor** (`event.ts`): `id, name, logoUrl, order, eventId`.
- **Ticket / Course:** `TicketDefinition` (`ticket.ts`): `ticketName, ticketCategory
(Triathlon|Duathlon|Marathon|Cycling|Swimming|Other), price, courseMaps{swim/bike/run
GpxUrl, distances, splits}, cutoffs`.
- **RaceCategory** (`event.ts`): `id, name, type(triathlon|swimathon|duathlon|other),
distances{swim,bike,run}, timingStructure, order`.
- **Participant:** `EventParticipant` (`participant.ts`): `bookingId, athleteUid,
name, email, bibNumber, ticketId, ticketStatus, amountPaidPaisa, ...`.
- **User/Profile:** `User` (`user.ts`): `uid, email, name, mobile, clubId,
upcomingEvents[], role, isVolunteer`.
- **Result:** `RaceResult` (`results.ts`): `bibNumber, name, status(Finished|DNF|
DNS|DNQ), chipTime, swim/bike/run, oRank/gRank/cRank, eventId, athleteUid`.
- **Split** (`results.ts`): `segment, name?, distance, time, absoluteTimestamp?,
position?{lat,lng}`.
- **LiveAthlete** (`results.ts`): `id, bib, name, category, gender, status, leg,
splits[], ranks, prediction, courseProgress`.
- **Ranking:** `RankedAthlete` (`results.ts`), `ClubRankingEntry` (`club.ts`).
- **TimingPoint:** `ResolvedTimingPoint` (`timingConfiguration.ts`),
  `LiveTrackingTimingPoint` (`event.ts`).
- **Announcement** (`announcement.ts`) ≈ Notification/News.
- **Certificate:** `CertificateGenerationRequest` (`event.ts`); no stored model.
- **Map/GPS:** GPX URLs on `TicketDefinition.courseMaps`; `Split.position{lat,lng}`,
  `LiveAthlete.predictedLocation`.

---

## 7. Services

- **API services:** `lib/api.ts` (unauthenticated Cloudflare Worker client:
  `getRankings, getRaceHistory, getParticipants, getEventStats, getLiveAthlete`),
  `lib/api/authenticatedFetch.ts` (Firebase-token Bearer wrapper).
- **Firebase services:** `lib/firebase.ts`, `lib/firebaseAdmin.ts`,
  `src/firebase/**` (`useCollection`, `useDoc`, `initializeFirebase`).
- **Cloudflare services:** `lib/cloudflare/kv.ts` (`getKV,putKV,batchGetKV,
listKVByPrefix`, throttle + read cache), `lib/live-tracking/cloudflareApi.ts`.
- **Repository pattern:** **not present** as such; nearest equivalents are
  `lib/dataLayerOptimized.ts` (KV-first reads) and `lib/liveTrackingParticipantStore.ts`.
- **Business services:** `lib/actions/**` server actions (events, results, rankings,
  participants, announcements, pages, sync).
- **Utility services:** `lib/services/templateService.ts` (notifications),
  `lib/athleteSearchEngine.ts`, `lib/timingConfiguration.ts`, `lib/courseIndex.ts`,
  `lib/splitIndex.ts`, `lib/predictionEngine` family.

---

## 8. React Architecture (web)

- **Data fetching:** **not React Query.** Web uses `fetch`/axios in `useEffect` +
  `setInterval` polling, server actions, and Firestore real-time hooks
  (`useCollection`/`useDoc`). Polling intervals per §4.
- **Context/Providers:** `AuthProvider` + `ClientAuthManager` (route guarding),
  `FirebaseProvider`, `CourseMapContext`, `TimingConfigurationContext`,
  `StoreCartContext`.
- **Caching:** Cloudflare KV (server) + in-process KV read cache; client keeps
  polled state in component state (no query cache).
- **Loading/errors/optimistic:** ad-hoc per component; no shared query-cache layer.

> Mobile improves on this: we use **React Query** for server state (with the web's
> polling intervals as `refetchInterval`) + repositories, which the web lacks.

---

## 9. Mobile Reuse Plan

| Module                                     | Verdict                       | Notes                                                                                                                                                                          |
| ------------------------------------------ | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Email OTP contract                         | **Reuse**                     | `/api/send-email-otp`, `/api/verify-email-otp` shapes.                                                                                                                         |
| Token model (SimpleJWT/refresh/mobile OTP) | **Rewrite / decision needed** | Web is Firebase custom-token → ID token; SimpleJWT & mobile OTP **do not exist**. Options in §2. Mobile already has a token/OTP seam ready for whichever the backend provides. |
| Live events list                           | **Reuse**                     | `GET /api/live/events`.                                                                                                                                                        |
| Leaderboard                                | **Reuse**                     | `GET /api/live/leaderboard/[eventId]` + filters; poll 5–10s (mobile), foreground-only.                                                                                         |
| Athlete search                             | **Reuse**                     | `GET /api/live/athlete-master-search/[eventId]`, 200ms debounce, recent searches local.                                                                                        |
| Athlete detail/timeline/splits             | **Reuse**                     | `GET /api/live/athlete-modal/[eventId]`, poll 5s.                                                                                                                              |
| Course map                                 | **Reuse (partial)**           | `GET /api/live/course-config` GPX + `/course-index`; render natively (react-native-maps) instead of Leaflet.                                                                   |
| Event detail                               | **Reuse**                     | `GET /api/live/events/[id]` + tracking config.                                                                                                               |
| Results / rankings                         | **Partial**                   | Public results/athlete-rankings have no JSON route; backend must expose one or mobile uses `/api/athlete-journey`.                                                             |
| Certificates                               | **Partial**                   | PDF generation endpoint is admin-only; needs a public/authed variant.                                                                                                          |
| Gallery                                    | **Reuse**                     | `GET /api/race-photos`.                                                                                                                                                        |
| Notifications/News                         | **Rewrite**                   | Web has no notifications API; mobile keeps local + push (Milestone 9).                                                                                                         |
| Firestore direct                           | **Not needed on mobile**      | Consume KV-backed REST via repositories; do not call Firestore from screens.                                                                                                   |

---

## 10. Implementation Plan (mobile)

Target mobile structure (already largely in place): `src/{app, core, shared,
features, mocks}` with `core/{navigation,providers,services{api,auth,firebase},
store,theme,types,utils,constants}`, `features/{home,events,tracking{leaderboard,
athlete-search,athlete-detail,watchlist,course-map,tracking-timeline,split-history},
athlete,auth,notifications,settings}`.

**Data flow (enforced):** Screen → React Query hook → Repository → API service → backend.

**Live tracking (Milestone 5) files to add:**

- `core/constants/env.ts` — add `EXPO_PUBLIC_LIVE_API_BASE` (default
  `https://bergmantri.com`) and tracking poll/cache constants.
- `core/services/api/liveClient.ts` — dedicated axios instance for `LIVE_API_BASE`.
- `core/services/tracking/trackingApi.ts` — typed calls mirroring §4 endpoints
  (live events, tracking feed, leaderboard, athlete search, athlete modal, course);
  a `mockTrackingApi` + `liveTrackingApi`, selected by config (mirrors the auth seam).
- `features/tracking/repositories/{TrackingRepository, LeaderboardRepository,
AthleteRepository, MapRepository}.ts` — call the service, map web payloads →
  app models (`EventModel`, `LeaderboardEntryModel`, `AthleteModel`, course types).
- `features/tracking/*/hooks/*` — React Query hooks with foreground-only polling
  (`useLiveEvents`, `useLeaderboard`, `useAthleteSearch`, `useAthleteDetail`,
  `useCourseMap`) and web-matched intervals/cache.
- Wire tracking screens to the hooks; reuse the existing design system components.

**Config-driven real/mock:** because production endpoints require network egress,
an API key (public events), and an in-progress live event, the mobile app keeps a
mock data source for offline/sandbox use and flips to the real endpoints via
`EXPO_PUBLIC_USE_LIVE_API` + `EXPO_PUBLIC_LIVE_API_BASE` — no screen/repo changes.

**Milestone order:** Auth (done, mock) → Firestore/read repositories → Repository
layer → Live tracking (leaderboard, search, detail, course, watchlist, timeline,
splits) → results → certificates → notifications → offline → performance → polish.

## 9. Confirmed data model (mobile = another BERGMAN client)

The mobile app is **another client of the existing BERGMAN backend**, not a
parallel service. Do **not** introduce a separate `/api/me` backend or read
Firestore directly — reuse the existing profile/registration/tracking REST APIs.

- **Athlete profile (GLOBAL)** — `Athlete { id, name, email, profilePhotoUrl,
club, city, country, … }`. Stored once and reused everywhere the athlete
  appears (athlete detail, leaderboard, search, live map, replay, results). The
  profile photo lives here; every per-event payload just echoes
  `profilePhotoUrl`.
- **Registration (PER EVENT)** — `Registration { eventId, athleteId, bib,
category, status, liveTrackingVisibility }`. Race-specific fields live here, so
  privacy is per registration: an athlete can be PUBLIC in one race and
  ANONYMOUS in another. `liveTrackingVisibility` is the canonical field name
  (the tracking payloads' `visibility` is accepted as an alias).

Code: `core/types/tracking.ts` (`Registration`, `Visibility`),
`core/repositories/profile.repository.ts` (global `AthleteProfile`),
and `features/tracking/mappers.ts` (`resolveVisibility` prefers
`liveTrackingVisibility`; photo hidden when not PUBLIC).

### Shared athlete profile endpoints (web + mobile)

`ProfileRepository` targets a single set of authenticated BERGMAN endpoints
(Bearer Firebase ID token) shared by both clients — no mobile-specific API:

| Method / path                                      | Purpose                                        |
| -------------------------------------------------- | ---------------------------------------------- |
| `GET /api/athletes/profile`                        | current athlete profile                        |
| `PATCH /api/athletes/profile`                      | update global profile fields                   |
| `POST /api/athletes/profile/photo`                 | upload/replace photo → `{ profilePhotoUrl }`   |
| `DELETE /api/athletes/profile/photo`               | remove photo                                   |
| `GET /api/athletes/registrations`                  | all event registrations for the athlete        |
| `PATCH /api/events/{eventId}/registration/privacy` | update `liveTrackingVisibility` for that event |

Photo upload uses `authenticatedUpload` (multipart); the others use
`authenticatedJson`. A mock implementation mirrors each behind
`EXPO_PUBLIC_USE_MOCK_DATA` for offline/demo. The authenticated Dashboard /
My-Profile UI is deferred until a test login + these contracts are live; the
repository/types are ready to consume them without further data-model changes.

### Shared-logic parity with the web app

The web app (`deccansports/bergman-app`) is the source of truth. These pure
helpers are ported to behave identically (verified against the same inputs):

- `getInitials` (`lib/utils.ts`) — first+last for multi-word, first two letters
  for single word, `'A'` fallback → `src/core/utils/avatar.ts`.
- `formatSecondsToHMS` / `hmsToSeconds` (`lib/utils.ts`) — always `HH:MM:SS`,
  `--:--:--` for invalid → `src/core/utils/format.ts` (used for split/timeline
  race times).
- `getCountryFlagEmoji` (`lib/utils.ts`) — name lookup against the shared
  `countryFlagsEmoji.json` (copied verbatim) → `src/core/utils/format.ts`.
- `normalizeLiveTrackingPrivacy` / `getParticipantLiveTrackingPrivacy`
  (`lib/liveTrackingPrivacy.ts`) — PRIVATE/ANONYMOUS/PUBLIC with `OFFICIALS_ONLY`
  / `ANON` aliases, reading the same candidate fields (`privacy`,
  `trackingVisibility`, `liveTrackingPrivacy`, registration/profile variants) →
  `mapAthleteDetail`'s `resolveVisibility` in `features/tracking/mappers.ts`.
