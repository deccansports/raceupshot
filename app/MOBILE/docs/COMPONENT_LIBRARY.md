# BERGMAN Race — Component Library

Status: Draft for approval
Scope: Official native mobile application only

The component library is small, consistent, and optimized for native feel. Every screen composes reusable components only; components are presentation-only and never call the network. Components consume design tokens from [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md).

## 1. Principles

- Presentation only: no Axios, no React Query, no server state inside components.
- Token-driven: colors, spacing, radius, typography, and elevation come from the theme.
- Accessible by default: labels, roles, dynamic type, and 44 x 44 minimum touch targets.
- Small and composable: prefer composition over configuration flags.
- Documented: every exported component has a documented prop contract.

## 2. Primitive Components

- `Screen` — safe areas, background color, keyboard avoidance, scroll behavior, tablet max-width options.
- `Text` — typography variants, colors, accessibility roles, dynamic type support.
- `Button` — variants: primary, secondary, ghost, destructive, icon; states: default, pressed, loading, disabled.
- `IconButton` — accessible icon-only action with proper hit target.
- `Card` — standard content container for event, athlete, result, and certificate summaries.
- `Input` — React Hook Form integration, error text, accessibility labels, dark mode styling.
- `ListItem` — shared row layout for settings, athletes, events, and search results.
- `Badge` — live, upcoming, finished, category, age group, rank, and status badges.
- `Chip` / `Tag` — filter chips and category tags.
- `Avatar` — athlete avatar with fallback initials.
- `Divider` — layout separation.
- `SearchBar` — debounced search input with clear affordance.
- `ProgressBar` — race/segment progress indication.

## 3. Feedback Components

- `LoadingState` — full-screen or inline loading affordance.
- `Skeleton` — content placeholder for perceived speed.
- `EmptyState` — no-data messaging with optional action.
- `ErrorState` / `ErrorView` — normalized error display with retry.
- `OfflineBanner` — explicit, non-disruptive offline indicator.
- `RefreshControl` — pull-to-refresh wrapper with themed styling.

## 4. Navigation and Overlay Components

- `BottomSheet` — gesture-driven sheet (Reanimated + Gesture Handler) for filters, athlete lists, and map overlays.
- `Modal` — themed modal container for search and filters routes.
- `Tabs` — segmented control for in-screen tabbing (for example leaderboard categories).

## 5. Race-Specific Components

Implemented in Milestone 2 (`shared/components/race`):

- `HeroBanner` — signature section opening every major screen (live/event and greeting patterns).
- `RaceStatusBadge` (+ `RaceStatus`) — four-state status system (LIVE/FINISHED/UPCOMING/NOT STARTED); LIVE pulses.
- `EventCard` — event summary with optional cover image and overlaid status badge.
- `LiveEventCard` — high-emphasis full-bleed live card with athlete count and Track Live CTA.
- `AthleteCard` — athlete summary with avatar, status, or rank.
- `ResultCard` — personal result with finish time, position, and pace.
- `CertificateCard` — finisher certificate entry with medal motif.
- `NewsCard` — editorial card with optional cover image.
- `LeaderboardRow` — rank, athlete, tabular time; podium emphasis and current-athlete highlight.
- `LeaderboardCard` — card wrapping a compact leaderboard.

Planned for later milestones:

- `SplitTimeline` — per-split status and timeline.
- `TrackingStatusPill` — live tracking status with accessible label.
- `CourseMap` — React Native Maps wrapper loaded only when focused.
- `MapMarker` / `SplitMarker` / `MarkerCluster` — themed markers and clustering (Milestone 7).

Supporting UI primitives added in Milestone 2: `Icon` (SVG icon set), `Stat` (bold metric), `FloatingActionButton`.

## 6. Component States

Data-bound composite components MUST render correctly for:

- Loading (skeleton or spinner).
- Empty (guidance and optional action).
- Error (message + retry).
- Content (final data).

List rows MUST be memoized and use stable keys.

## 7. Prop Contract Conventions

- Props are strictly typed; no `any`.
- Prefer explicit variant unions over boolean flags where variants are mutually exclusive.
- Accessibility props (`accessibilityLabel`, `accessibilityRole`, state) are first-class, not afterthoughts.
- Style overrides are limited and token-based; avoid arbitrary inline colors.

## 8. Performance Guidance

- Prefer optimized `FlatList` with memoized rows and careful item layout; consider FlashList only if the dependency policy expands.
- Avoid rendering hidden expensive map overlays.
- Use `Skeleton` during transitions rather than blocking spinners where it improves perceived speed.

## 9. Documentation and Testing

- Each exported component documents its props and variants.
- Components are candidates for snapshot and interaction tests as the test strategy in [DEVELOPMENT_GUIDELINES.md](DEVELOPMENT_GUIDELINES.md) is established.
