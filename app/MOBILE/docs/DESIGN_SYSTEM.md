# BERGMAN Race — Design System

Status: Draft for approval
Scope: Official native mobile application only

The theme provides a premium, high-contrast design with light and dark modes. Final brand values (exact BERGMAN Red/Blue hex, logo assets, and typography) are confirmed at the approval gate.

## 1. Brand Foundations

Core palette:

- White
- Black
- BERGMAN Red (primary brand accent)
- BERGMAN Blue (secondary brand accent)

Visual language:

- Rounded cards
- Soft shadows
- Large, confident typography
- Generous spacing and clear hierarchy
- Full dark mode support
- Tablet-aware layouts

## 2. Design Tokens

### 2.1 Color

- background
- surface
- elevated surface
- text primary
- text secondary
- text muted
- border
- accent (BERGMAN Red)
- accent secondary (BERGMAN Blue)
- success
- warning
- danger
- live

All semantic colors MUST have light and dark variants, including map, chart, skeleton, and status colors.

### 2.2 Spacing

Spacing scale (points): 4, 8, 12, 16, 20, 24, 32, 40, 48.

### 2.3 Radius

- small
- medium
- large
- full

### 2.4 Typography

- display
- title
- headline
- body
- body small
- label
- mono metric (for times, paces, and splits)

### 2.5 Elevation

- card
- floating control
- modal

## 3. Color Mode Behavior

- Default to the system color scheme.
- Allow explicit light, dark, or system preference.
- Persist appearance preference with Zustand persistence.
- Ensure maps, charts, skeletons, and status colors have dark mode variants.

## 4. Theming Implementation

- Tokens live in `src/theme/` (`colors.ts`, `spacing.ts`, `typography.ts`, `shadows.ts`, `theme.ts`).
- A theme bridge in the root layout resolves the active color mode and provides tokens through context.
- Components read tokens from the theme; no component hardcodes raw color or spacing values.

## 5. Accessibility

- Maintain WCAG-friendly contrast for all text and controls.
- Support dynamic type across typography variants.
- Ensure touch targets are at least 44 x 44 points.
- Provide semantic labels for map controls, tracking status, ranks, and certificates.
- Avoid color-only status communication (pair color with text, icon, or shape).
- Support reduced motion by shortening or disabling non-essential animations.

## 6. Motion Principles

Use React Native Reanimated and Gesture Handler for:

- Press feedback.
- Bottom sheet gestures.
- Map overlay transitions.
- Watchlist add/remove micro-interactions.
- Skeleton-to-content transitions.
- Tab and stack transitions where Expo Router allows customization.

Animations should be short, interruptible, and reduce motion when the user has reduced motion enabled.

## 7. Iconography and Illustration

- Use React Native SVG for scalable icons and brand marks.
- Icons follow a consistent stroke weight and grid; provide accessible labels where interactive.

## 8. Status Color Semantics

- live: an event or athlete is actively being tracked.
- success: finished, verified, or completed states.
- warning: stale data or degraded connectivity.
- danger: errors and destructive actions.

Status meaning is always reinforced with text or icon, never color alone.

## 9. Responsive and Tablet Rules

- Phone: tab-first navigation, full-width lists, map overlays as bottom sheets, compact leaderboard rows.
- Tablet: max-width reading columns, two-column event detail where useful, persistent side panels for map plus athlete list, larger map-first live tracking layouts.
- Responsive behavior derives from device dimensions and platform utilities, not separate tablet-only screens unless necessary.

Component-level contracts that consume these tokens are defined in [COMPONENT_LIBRARY.md](COMPONENT_LIBRARY.md).

---

# BERGMAN Design Language (Milestone 2 Audit & Refinement)

## Audit summary

The initial system was correct but generic. This refinement gives BERGMAN a
distinctive, premium endurance-sports identity while keeping the native feel on
iOS and Android. Goals reviewed: modern endurance aesthetic, premium native feel,
fast visual scanning during races, accessibility, dark mode, and tablet layouts.

Key moves: a more confident brand palette with dedicated race-status colors, a
scale of bold tabular number styles for metrics/timing, larger card rounding with
edge-to-edge imagery, a signature Hero Banner system, specialized race cards, and
a clear four-state race-status system.

## 1. Brand Colors

- BERGMAN Red `#E1122A` (light) / `#FF3341` (dark) — primary accent.
- BERGMAN Blue `#0B4EA2` (light) / `#2E74D6` (dark) — secondary accent.
- Ink `#0B0D12` — near-black background/text base.
- Semantic: `background`, `surface`, `surfaceElevated`, `surfaceSunken`, `text{Primary,Secondary,Muted,Inverse}`, `border`, `borderStrong`, `onAccent`, `scrim`.
- Feedback: `success`, `warning`, `danger`.
- Live status colors: `statusLive` (red), `statusFinished` (green), `statusUpcoming` (amber), `statusNotStarted` (grey). Tokens live in `core/theme/colors.ts`.

## 2. Typography Scale

`displayLarge, display, heroTitle, title, headline, body, bodySmall, label, caption, metric, metricSmall, monoMetric`. Metrics and timing use bold, `tabular-nums` so numbers align in split tables and scan fast. See `core/theme/typography.ts`.

## 3. Spacing Scale

`4, 8, 12, 16, 20, 24, 32, 40, 48` (`xs…huge`). See `core/theme/spacing.ts`.

## 4. Elevation System

`card` (subtle), `floating` (FABs, sheets), `modal` (dialogs). Soft, low-opacity shadows for a premium feel. See `core/theme/shadows.ts`.

## 5. Border Radius System

`small 8, medium 12, large 20, xl 28, full`. BERGMAN favors large rounding on cards and hero sections. See `core/theme/radius.ts`.

## 6. Animation Principles — "BERGMAN Motion: Fast, Clean, Confident"

- Durations: fast 120ms, base 200ms, slow 320ms; a single standard spring.
- Press feedback via subtle scale (`usePressScale`).
- All motion respects reduce-motion (`useReducedMotion`); animations are short and interruptible. See `core/theme/motion.ts`.

## 7. Iconography Guidelines

- Single `Icon` component (React Native SVG), 24×24 grid, 2px stroke, rounded caps/joins.
- Decorative by default; wrap in a labelled pressable when interactive.
- Consistent set: chevronRight, arrowRight, calendar, location, clock, trophy, medal, bell, share, search.

## 8. Card Variants — "BERGMAN Cards: large rounded, edge-to-edge imagery, floating actions"

- Base `Card` (elevated/flat, optional press).
- Specialized: `EventCard`, `LiveEventCard`, `AthleteCard`, `ResultCard`, `CertificateCard`, `NewsCard`, `LeaderboardCard`.

## 9. Button Variants

- `Button`: primary, secondary, ghost, destructive; sizes sm/md/lg; loading/disabled states.
- `FloatingActionButton`: extended (label) or circular (icon-only) for primary screen actions.

## 10. List Patterns

- `ListItem` (leading/title/subtitle/trailing, pressable) for settings/athletes/search.
- `LeaderboardRow` for dense, tabular race standings with podium emphasis and a "you" highlight.

## 11. Hero Banner Pattern

`HeroBanner` opens every major screen. Two patterns:

- Live/event: edge-to-edge image + scrim, status badge, big stats, floating CTA.
- Greeting: solid brand background, eyebrow greeting, next-race title, countdown stat.

## 12. Live Event Card Pattern

`LiveEventCard`: full-bleed image with scrim, pulsing LIVE badge, large athlete-count stat, and a "Track Live →" affordance.

## 13. Athlete Card Pattern

`AthleteCard`: avatar + name + category/bib, with either a live status badge, a rank metric, or a chevron.

## 14. Leaderboard Row Pattern

`LeaderboardRow`: fixed-width bold rank (podium in accent), avatar, name/detail, right-aligned `monoMetric` time; optional row highlight for the current athlete.

## 15. Event Card Pattern

`EventCard`: optional cover image with overlaid status badge, title, calendar + discipline, and location — optimized for fast scanning of an events list.

## Race Status System

`🔴 LIVE · 🟢 FINISHED · 🟡 UPCOMING · ⚪ NOT STARTED` — implemented as
`RaceStatus` + `RaceStatusBadge` (colored dot + label; LIVE pulses, reduce-motion
aware; always pairs color with text for accessibility).

All components remain dark-mode, tablet, accessibility, and reduce-motion aware,
and are previewed in the development-only Component Showcase.
