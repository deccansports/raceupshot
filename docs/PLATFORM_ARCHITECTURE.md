# Race Upshot shared platform

## Implemented foundation

The web application and Expo mobile application use one versioned API contract:

```text
Timing provider
  -> trusted server-side synchronization adapter
  -> normalized event / participant / timing models
  -> RACEUPSHOT KV live snapshots + D1 indexes
  -> /api/v1/*
  -> web and mobile clients
```

Provider credentials and provider endpoints never enter public KV payloads,
browser code, Expo environment variables, or API responses.

Shared packages:

- `packages/contracts`: event, live participant, split, privacy, API response,
  mobile settings and Feibot configuration types.
- `packages/privacy-core`: backend visibility resolution and response shaping.
- `packages/timing-core`: provider-neutral status and Feibot participant
  normalization plus stable matching keys.

## Identity rules

The stable participant lifecycle is:

```text
Registered -> Start list -> On course -> Finished -> Provisional -> Official
```

The same `eventId`, `contestId`, `participantUid`, optional `athleteUid`, bib and
split history must be preserved throughout. Matching candidates are generated
in this order:

1. Confirmed athlete UID
2. Participant UID
3. Registration ID
4. Verified normalized-email hash
5. Event + contest + bib
6. Manual administrator mapping

Names are never matching keys.

## Privacy boundary

Public participant and leaderboard endpoints call the shared privacy resolver
before serializing data:

1. Disabled public live tracking returns no public athlete.
2. Forced event visibility wins.
3. An administrator athlete override wins next.
4. The athlete preference is used when allowed.
5. The event default is the fallback.

`PRIVATE` participants are removed. `ANONYMOUS` participants retain bib, race
state and splits but lose full name, photo, country, club and team.

## Versioned API

Public:

- `GET /api/v1/events?section=UPCOMING|LIVE|PAST`
- `GET /api/v1/events/{eventId}`
- `GET /api/v1/events/{eventId}/mobile`
- `GET /api/v1/events/{eventId}/live`
- `GET /api/v1/events/{eventId}/participants?q=`
- `GET /api/v1/events/{eventId}/participants/{participantUid}`
- `GET /api/v1/events/{eventId}/leaderboards`
- `GET /api/v1/events/{eventId}/leaderboards/{contestId}`
- `GET /api/v1/events/{eventId}/results`
- `GET /api/v1/events/{eventId}/results/{resultId}`
- `GET /api/v1/events/{eventId}/course`
- `GET /api/v1/events/{eventId}/announcements`

Admin:

- `GET /api/v1/admin/events/{eventId}/settings`
- `PATCH /api/v1/admin/events/{eventId}/settings`

Every v1 success response contains `apiVersion`, source, update time, stale
state, cache seconds and request ID. Public interfaces must render the stale
state and never imply that old timing is current.

## Cloudflare storage

Current production bindings expose Assets and `RACEUPSHOT` KV.

`migrations/0002_shared_live_platform.sql` prepares D1 tables for provider
accounts, event integration, contest and participant mapping, live search
indexes, privacy overrides, synchronization runs, notification deduplication
and result claims.

Before enabling D1/R2-dependent modules:

1. Create a Race Upshot-specific D1 database.
2. Apply both migrations in numeric order.
3. Create a Race Upshot-specific R2 bucket.
4. Add D1 and R2 bindings to `wrangler.jsonc`.
5. Regenerate `cloudflare-env.d.ts`.
6. Keep provider credentials in Worker secrets.

Do not connect the app to an unrelated existing bucket.

## Feibot activation gate

The admin page stores only:

- HTTPS base URL
- Secret account reference
- Provider event UUID
- Module switches and intervals
- Web/mobile visibility
- Public synchronization status

Actual Feibot requests remain gated until the provider's authenticated endpoint
contract and credentials are supplied. Do not guess provider URLs or payload
fields. When the adapter is added it must validate every response, isolate
module failures, prevent overlapping runs and use an idempotency key.

## Firebase activation gate

The mobile account surface is scaffolded but athlete authentication is not
enabled without the Race Upshot Firebase project configuration and server
credentials. When supplied:

1. Web and mobile use the same Firebase Authentication project.
2. Protected APIs verify Firebase ID tokens server-side.
3. Firestore athlete documents remain authoritative for profiles, privacy,
   watchlist sync and notification preferences.
4. Timing-provider data cannot overwrite profile, payment, waiver, medical,
   emergency-contact or registration records.

## Mobile application

`apps/mobile` is a separate Race Upshot Expo Router app with Home, Events, Live,
Watchlist and My Account tabs. It consumes only `/api/v1`, supports the
`raceupshot://` scheme, stores an anonymous watchlist locally, refreshes live
data every 15 seconds and surfaces timing freshness.

Run:

```bash
npm run mobile:install
cp apps/mobile/.env.example apps/mobile/.env.local
npm run mobile:start
```
