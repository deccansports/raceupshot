# Race Upshot

Race Upshot is a Cloudflare-native sports timing frontend connected to the production `raceupshot` Worker and its `RACEUPSHOT` KV namespace.

## Initial-release boundary

The core release is deliberately limited to:

1. Public website and CMS
2. Event and category management
3. CSV/XLSX participant and result import
4. Public leaderboards
5. Athlete result pages
6. Polling-based live-result refresh
7. Verified certificate generation
8. Admin roles, permissions, and audit logs

WhatsApp messaging, athlete accounts, race-history claiming, live GPS tracking, and photo matching are post-core modules. They should not enter the critical path until timing ingestion, ranking, publication, certificates, and recovery procedures are stable in production.

## What works

- Premium responsive public site with original Race Upshot branding and imagery
- Search real Worker event and result records by event, athlete name, or bib
- Filterable event directory and event detail pages
- Results directory, server-shaped leaderboard, and mobile card presentation
- Live leaderboard with refresh state and configurable polling UI
- Athlete result page with multisport splits, ranks, verification, and certificate actions
- Signed admin sessions and Worker-backed operations dashboard analytics
- Validated event form, category creation, four-stage CSV/XLSX import UI, publication controls, and CMS editor
- Verified public certificate route plus generation, preview, revocation, and print/PDF actions
- Admin user/role matrix and searchable append-only audit-log interface
- D1 schema and starter seed migration
- OpenNext + Cloudflare Workers configuration with production Assets and KV bindings
- Shared v1 event/live/result API contracts with backend athlete privacy
- Event-level web, live, mobile and Feibot-reference configuration
- Public live athlete directory, split timeline, leaderboard and local watchlist
- Separate Expo Router iOS/Android app in `apps/mobile`

Public events, results, athlete detail, live refresh, homepage slides, audit data, event mutations, and certificate templates use the `RACEUPSHOT` KV binding. Browser-local demo persistence and fabricated race records have been removed.

## Local development

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

Development uses Next.js Webpack mode because macOS AppleDouble metadata on some external drives can corrupt Turbopack's persistent cache database. Production builds remain optimized with the standard Next.js build pipeline.

Admin:

- URL: `/admin/login`
- Copy `.dev.vars.example` to `.dev.vars`, then set `ADMIN_PASSWORD` and a long random `ADMIN_SESSION_SECRET`.
- The admin email is configured as `info@raceupshot.com`.

CMS:

- `/admin/cms` stores draft and published page snapshots in `RACEUPSHOT` KV.
- The About page supports multiple add/remove/reorder HTML blocks.
- HTML is allowlist-sanitized on save and again on public read.
- Supported CMS presentation classes are shown inside the editor, with a sandboxed styled preview.

Quality checks:

```bash
npm run lint
npm test
npm run build
npm run mobile:typecheck
```

Mobile development:

```bash
npm run mobile:install
cp apps/mobile/.env.example apps/mobile/.env.local
npm run mobile:start
```

The app uses the `raceupshot://` deep-link scheme and consumes only `/api/v1`.
See [the shared platform architecture](docs/PLATFORM_ARCHITECTURE.md) for
privacy resolution, identity matching, storage ownership and activation gates.

## Cloudflare setup

The checked-in `wrangler.jsonc` targets the existing `raceupshot` Worker and KV namespace:

```bash
npm run cf:typegen
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put ADMIN_SESSION_SECRET
npx wrangler secret put TURNSTILE_SITE_KEY
npx wrangler secret put TURNSTILE_SECRET_KEY
```

Wrangler is already authenticated locally with OAuth, so a Cloudflare API token is not required for development. `.env.local` contains only the non-secret account ID and R2 endpoint. The credential fields are deliberately blank: create new credentials after rotating any values that were shared in chat.

Use `.env.local` only for local CLI/S3 tooling. Use `.dev.vars` for local Worker runtime secrets and `wrangler secret put` for production Worker secrets. Never prefix Cloudflare, R2, admin-password, or session-secret variables with `NEXT_PUBLIC_`.

Create a Cloudflare Turnstile widget for the public Race Upshot hostname before
setting the two Turnstile values. The contact form fails closed when either the
widget site key or server-side secret is unavailable.

R2 S3 access keys are for external S3 clients. Worker code should use an R2 binding instead, which does not require shipping S3 credentials to the Worker. As of 26 July 2026, this account has no Race Upshot-specific R2 bucket, so the app intentionally does not bind to any existing unrelated bucket.

After real resource IDs are configured:

```bash
npm run preview
npm run deploy
```

## Architecture

```text
Browser
  ├─ Public App Router pages
  └─ Protected admin pages
          │
          ▼
Next.js route handlers / server actions on Cloudflare Workers
  ├─ Session + CSRF + permission guard
  ├─ Zod request contracts
  ├─ Repositories
  │    └─ KV: existing events, results, audit indexes, slider and template records
  └─ Services
       ├─ Import coordinator ──► Queue consumer
       ├─ Ranking engine
       ├─ Snapshot publisher
       ├─ Certificate generator ──► R2
       └─ Notification coordinator ──► Queue consumer
```

The current deployed resources expose Assets and KV only. CSV/XLSX raw-file ingestion and generated certificate files remain disabled until a file-storage binding and authenticated background import processor are added.

## Route map

Public:

- `/`, `/about`, `/services`, `/contact`
- `/events`, `/events/[slug]`
- `/results`, `/results/[eventSlug]`
- `/results/[eventSlug]/athlete/[participantId]`
- `/live`, `/live/[slug]`
- `/events/[slug]/live`
- `/events/[slug]/athletes`, `/events/[slug]/athletes/[participantUid]`
- `/events/[slug]/leaderboard`, `/events/[slug]/results/[resultId]`
- `/certificate/[verificationCode]`

Admin:

- `/admin/login`, `/admin`
- `/admin/events/new`
- `/admin/events/[id]/platform`
- `/admin/imports`
- `/admin/results`
- `/admin/cms`
- `/admin/certificates`
- `/admin/users`
- `/admin/audit-logs`

Versioned shared API boundaries:

- `GET /api/v1/events`, `GET /api/v1/events/:eventId`
- `GET /api/v1/events/:eventId/live|participants|leaderboards|results`
- `GET /api/v1/events/:eventId/course|announcements|mobile`
- `GET/PATCH /api/v1/admin/events/:eventId/settings`
- Existing `/api/public/*` routes remain compatible during client migration.
- `POST /api/timing/v1/events/:eventId/reads|results|splits|status`
- `GET /api/health`, `GET /api/admin/system/health`

Every API should return the response envelope specified in the brief and attach a cryptographically random request ID.

## Authentication and authorization

The production authentication boundary should use an HTTP-only, `Secure`, `SameSite=Lax` session cookie with rotated opaque session IDs. Store only a session hash server-side, require CSRF tokens on mutations, rate-limit sign-in attempts, and optionally add a magic-link or second-factor challenge.

Each admin route handler must call a server-side permission guard such as `requirePermission("results.publish")`. UI visibility is helpful but is never the security boundary. Audit authentication, publication, user/role, participant, integration, certificate, and CMS changes.

## Project structure

```text
app/                 Next.js App Router screens and global styles
components/          Reusable public, result, live, form and admin UI
lib/                 Typed Worker/KV repositories, auth and utilities
migrations/          Rollback-safe D1 schema and development seed
public/              Original generated brand imagery
tests/               Unit tests for stable Worker data contracts
wrangler.jsonc       OpenNext Worker and Cloudflare bindings
```

## Original generated asset

`public/race-upshot-hero.png` was generated specifically for this project with the built-in image generation tool. Final prompt: a cinematic blue-hour urban endurance finish, original generic event, runners on the right with left-side copy space, subtle RFID mats, deep navy/electric blue palette, restrained orange lighting, no logos or readable branding.
