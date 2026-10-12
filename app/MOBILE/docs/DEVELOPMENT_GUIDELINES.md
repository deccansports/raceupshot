# BERGMAN Race — Development Guidelines

Status: Draft for approval
Scope: Official native mobile application only

These guidelines govern code quality, structure, tooling, and workflow. They apply once implementation begins after approval.

## 1. Language and Types

- Strict TypeScript everywhere; `strict` mode enabled.
- No `any`. Prefer precise types, unions, and generics.
- Validate external data with Zod at API boundaries (see [API_INTEGRATION.md](API_INTEGRATION.md)); infer types from schemas where practical.
- Shared types live in `src/types/`; feature types live in the feature's `types.ts`.

## 2. Architecture Rules

- Feature-first structure per [ARCHITECTURE.md](ARCHITECTURE.md); each feature is isolated and reusable.
- Never mix UI with API logic: components are presentation-only.
- No Axios calls inside screens or components; use endpoint modules via feature hooks.
- React Query for server state, Zustand for global client state; never duplicate state.
- Never hardcode API URLs; use environment configuration and centralized endpoint modules.
- No backend/database/infra SDKs (no Firebase, Firestore, Cloudflare, KV, or direct DB access).

## 3. Components

- Keep components small and composable; extract logic into hooks.
- Document exported components and their prop contracts.
- Prefer variant unions over boolean flags for mutually exclusive states.
- Provide accessibility props by default; meet 44x44 touch targets and contrast requirements.
- Avoid unnecessary re-renders: memoize rows, stabilize callbacks, and use selector-driven Zustand reads.

## 4. State and Data

- Centralize query keys in `src/services/api/queryKeys.ts`.
- Scope polling to focused screens; back off on background/poor network/non-live events.
- Use optimistic updates only where specified (for example watchlist) with rollback.
- Store only tokens/metadata in Secure Store; never full payloads.

## 5. Styling and Theme

- Consume design tokens from `src/theme/`; never hardcode raw colors or spacing.
- Support light/dark/system and reduced motion.
- Use React Native SVG for icons and brand marks.

## 6. Tooling

- ESLint and Prettier enforce style and catch issues; code must pass lint with no errors before merge.
- TypeScript type-check must pass (`tsc --noEmit` or the project's configured check).
- Recommended npm scripts once the project is initialized:
  - `start` — Expo dev server
  - `ios` / `android` — run on simulator/emulator
  - `lint` — ESLint
  - `format` — Prettier
  - `typecheck` — TypeScript no-emit check
  - `test` — test runner

## 7. Testing Strategy

- Unit tests for utilities, formatters, and pure logic.
- Component tests for reusable UI states (loading/empty/error/content).
- Integration tests for feature hooks against mocked endpoint modules.
- Manual verification on iOS and Android for each milestone, including dark mode and tablet.
- Live/polling flows verified for focus, background, and network transitions.

## 8. Git and Review Workflow

- Work milestone by milestone; do not build the whole app at once.
- Small, focused commits with clear messages.
- After each milestone: explain the implementation, confirm it compiles and passes lint/type checks, and wait for approval before continuing.
- Keep pull requests scoped to a single milestone or a coherent slice.

## 9. Performance Checklist

- Optimized lists with memoized rows and stable keys.
- Lazy load heavy views (maps) only when focused.
- Image caching and request cancellation on unmount/key change.
- Background refresh where appropriate; avoid hidden expensive overlays.

## 10. Accessibility Checklist

- Semantic labels for map controls, tracking status, ranks, and certificates.
- Dynamic type support and sufficient contrast in light and dark.
- No color-only status communication.
- Respect reduced motion.

## 11. Definition of Done (per milestone)

- Meets the milestone exit criteria in [ROADMAP.md](ROADMAP.md).
- Lint, type-check, and tests pass.
- Manually verified on iOS and Android, including dark mode and tablet where relevant.
- Documentation updated if behavior or structure changed.
