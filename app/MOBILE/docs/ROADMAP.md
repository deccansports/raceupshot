# BERGMAN Race — Roadmap

Status: Draft for approval
Scope: Official native mobile application only

Work proceeds milestone by milestone. Never build the entire application at once. After each milestone: explain the implementation, confirm everything compiles and passes lint/type checks, and wait for approval before continuing.

Milestones are sequenced by dependency, not by calendar time.

## Milestone 1 — Project Foundation

- Initialize the Expo (latest SDK) TypeScript project with Expo Router.
- Establish the feature-first folder structure from [ARCHITECTURE.md](ARCHITECTURE.md).
- Configure strict TypeScript, ESLint, Prettier, and path aliases.
- Add core providers: safe area, gesture handler root, React Query client, theme bridge.
- Wire environment configuration for the API base URL (no hardcoded paths).
- Exit criteria: app boots to an empty themed shell; lint and type checks pass.

## Milestone 2 — Design System

- Implement design tokens (`colors`, `spacing`, `typography`, `shadows`, `theme`).
- Implement color mode (light/dark/system) with Zustand persistence.
- Build primitive and feedback components from [COMPONENT_LIBRARY.md](COMPONENT_LIBRARY.md).
- Establish accessibility defaults (labels, dynamic type, 44x44 targets, reduced motion).
- Exit criteria: component gallery renders in light/dark on phone and tablet.

## Milestone 3 — Home

- Build the tab navigator and Home screen.
- Integrate upcoming/live event summaries via React Query hooks (mocked or contract-based until API is final).
- Implement loading/empty/error/content states and recently viewed client state.
- Exit criteria: Home renders real states end to end for guests.

## Milestone 4 — Events

- Events list with filters, search entry, pagination, and pull-to-refresh.
- Event details screen and event stack navigation.
- Offline cache and offline banner.
- Exit criteria: browse and open events with caching and filters.

## Milestone 5 — Live Tracking

- Leaderboards with category/age filters and focused polling.
- Live event status with last-updated and stale indicators.
- Polling lifecycle tied to focus, background, network, and event live state.
- Exit criteria: live leaderboard updates while focused and backs off correctly.

## Milestone 6 — Athlete Details

- Athlete detail, tracking timeline, splits, and status.
- Athlete search (debounced) and watchlist add/remove with optimistic updates.
- Exit criteria: follow an athlete and view live tracking detail.

## Milestone 7 — Course Maps

- React Native Maps integration with course rendering and split markers.
- Focused-only map loading, clustering, and cached metadata.
- Phone bottom-sheet and tablet side-panel overlays.
- Exit criteria: course map renders with markers and overlays on both platforms.

## Milestone 8 — Athlete Hub

- Athlete login (React Hook Form + Zod) and Secure Store token handling.
- My Events, Results, Rankings, Certificates, and Profile.
- Auth bootstrap gating for authenticated routes; expiration handling.
- Exit criteria: authenticated athlete can view personal data; guest mode intact.

## Milestone 9 — Notifications

- Expo Notifications setup, contextual permission flow, and push token registration.
- Notification response routing through Expo Router with Home fallback.
- Notification preferences (server + local mirror).
- Exit criteria: receive and route a test notification to the correct screen.

## Milestone 10 — Testing and Store Release

- Testing across critical flows (unit/component/integration as established in [DEVELOPMENT_GUIDELINES.md](DEVELOPMENT_GUIDELINES.md)).
- Performance passes: list optimization, image caching, request cancellation, background refresh.
- Accessibility audit and dark mode/tablet verification.
- App Store and Google Play assets, configuration, and submission readiness.
- Exit criteria: production-ready builds validated for iOS and Android.

## Dependencies and Risks

- API contract (paths, payloads, auth/refresh behavior) must be confirmed before data screens are finalized.
- Map provider requirements and keys for iOS and Android must be provided before Milestone 7.
- Push notification registration endpoint and payload format must be provided before Milestone 9.
- Brand assets (colors, logo, typography) must be confirmed before finalizing the design system.

See the Approval Checklist in [mobile-architecture.md](mobile-architecture.md) for the full list of items to confirm before implementation.
