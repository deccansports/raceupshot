# BERGMAN Race — Project Overview

Status: Draft for approval
Scope: Official native mobile application only
Platforms: iOS and Android
Out of scope: backend services, APIs, Cloudflare Workers, Firestore, Cloudflare KV, direct database access

## 1. Summary

BERGMAN Race is the official native mobile application for BERGMAN endurance events. It is a premium Expo React Native application for endurance race discovery, live tracking, athlete following, results, certificates, and athlete account features. The application targets a native-quality experience comparable to Apple Fitness, Strava, Garmin Connect, Nike Run Club, and IRONMAN Tracker while remaining uniquely BERGMAN.

The app is a pure client. It consumes existing REST APIs exclusively and treats all backend systems as external dependencies. No backend, database, Firebase, Cloudflare, or direct infrastructure SDK is part of this project.

## 2. Vision

Build the world's best endurance sports race application: fast, premium, elegant, and native. Every design and engineering decision should prioritize:

- Speed and perceived performance
- Simplicity and clarity
- Reliability, including intermittent connectivity at race venues
- Accessibility
- Scalability and maintainability
- Athlete-first account experience
- Spectator-first live tracking
- Beautiful, native-feeling UI

## 3. Product Pillars

- Discovery: browse upcoming and live events with premium cards and filters.
- Live tracking: real-time leaderboards, athlete positions, splits, and status.
- Following: search athletes, build a watchlist, and receive race notifications.
- Athlete hub: authenticated access to personal events, results, certificates, and profile.
- Trust: accurate data, clear last-updated indicators, and graceful offline behavior.

## 4. Target Users

- Guest / Spectator
  - Discover upcoming and live events.
  - Search athletes.
  - View leaderboards, maps, athlete details, and public results.
  - Build a watchlist and receive race notifications.
- Athlete
  - Authenticate with the existing athlete login API.
  - View personal events, results, certificates, profile, settings, and notification preferences.

Guest mode is fully usable without login. Athlete features layer on top of guest capabilities after authentication.

## 5. Platforms and Distribution

- iOS via the Apple App Store.
- Android via the Google Play Store.
- React Native Web is out of scope unless required by Expo tooling. Optimize for iOS and Android first.
- The app must support phones and tablets with adaptive layouts.

## 6. Quality Bar

- Native-quality user experience and motion.
- Minimal, premium interface with excellent perceived performance.
- Strong dark mode support.
- Tablet-aware layouts.
- Accessible interactions, typography, color contrast, and screen reader labels.
- Offline-tolerant behavior for previously viewed data.
- Clear separation between mobile presentation, state, REST data access, and device integrations.

## 7. Constraints and Guardrails

- The backend already exists; the app is a consumer of REST APIs only.
- Do not add Firebase, Firestore, Cloudflare, KV, database, or backend SDK dependencies.
- Do not create API routes, server functions, workers, or backend services.
- Do not place networking calls inside screen components.
- Do not store secrets or tokens outside Expo Secure Store.
- Do not assume API URL paths until the API contract is available.
- Keep all implementation TypeScript-first and route-driven through Expo Router.

## 8. Documentation Map

This documentation set defines the product and engineering plan before any code is written:

- [PROJECT_OVERVIEW.md](PROJECT_OVERVIEW.md): product vision, users, scope, and quality bar.
- [PRODUCT_REQUIREMENTS.md](PRODUCT_REQUIREMENTS.md): module-by-module functional and non-functional requirements.
- [ARCHITECTURE.md](ARCHITECTURE.md): technology stack, feature-first architecture, and boundaries.
- [NAVIGATION.md](NAVIGATION.md): Expo Router structure, navigation hierarchy, and deep links.
- [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md): brand, design tokens, theming, and accessibility.
- [COMPONENT_LIBRARY.md](COMPONENT_LIBRARY.md): reusable component inventory and contracts.
- [API_INTEGRATION.md](API_INTEGRATION.md): REST client, endpoint modules, validation, and error model.
- [STATE_MANAGEMENT.md](STATE_MANAGEMENT.md): React Query and Zustand responsibilities and caching.
- [ROADMAP.md](ROADMAP.md): milestone plan from foundation to store release.
- [DEVELOPMENT_GUIDELINES.md](DEVELOPMENT_GUIDELINES.md): coding standards, tooling, and workflow.

The existing [mobile-architecture.md](mobile-architecture.md) is the originating architecture proposal and remains the reference source for the approved direction.

## 9. Approval Gate

No application code should be produced until this documentation set is approved. Implementation proceeds milestone by milestone as defined in [ROADMAP.md](ROADMAP.md).
