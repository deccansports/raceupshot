# BERGMAN Mobile

Official BERGMAN Race mobile application for iOS and Android.

Built with Expo (SDK 57), Expo Router, and TypeScript. Milestone 1 (Project Foundation) is in place: providers, theme system, state, API client, and folder structure. Product screens are built in later milestones (see [docs/ROADMAP.md](docs/ROADMAP.md)).

## Getting Started

Prerequisites: Node.js 20+ and npm. The canonical project is now located at
`apps/mobile` inside the BERGMAN web repository.

```bash
npm install            # install dependencies
cp .env.example .env   # configure EXPO_PUBLIC_* variables (optional)
npm start              # start the Expo dev server (Metro)
```

Then run on a target:

```bash
npm run ios       # iOS simulator (macOS)
npm run android   # Android emulator/device
npm run web       # web (used for quick verification)
```

Quality checks:

```bash
npm run typecheck    # tsc --noEmit
npm run lint         # eslint (expo config)
npm run format       # prettier --write
```

The same commands can be launched from the repository root with the
`mobile:*` scripts documented in [`../../MONOREPO.md`](../../MONOREPO.md).

## Documentation

Planning documentation for the official native mobile application (produced before any code is written; awaiting approval):

- [Project Overview](docs/PROJECT_OVERVIEW.md)
- [Product Requirements](docs/PRODUCT_REQUIREMENTS.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Navigation](docs/NAVIGATION.md)
- [Design System](docs/DESIGN_SYSTEM.md)
- [Component Library](docs/COMPONENT_LIBRARY.md)
- [API Integration](docs/API_INTEGRATION.md)
- [Live Tracking Integration](docs/LIVE_TRACKING_INTEGRATION.md)
- [State Management](docs/STATE_MANAGEMENT.md)
- [Authentication](docs/AUTHENTICATION.md)
- [Roadmap](docs/ROADMAP.md)
- [Development Guidelines](docs/DEVELOPMENT_GUIDELINES.md)

Reference:

- [Mobile Architecture Proposal](docs/mobile-architecture.md)
- [Web App Architecture Audit](docs/WEB_APP_ANALYSIS.md) (source-of-truth analysis driving integration)
