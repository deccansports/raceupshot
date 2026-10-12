# Building & testing on a device (EAS)

## Why `npx expo start` + Expo Go doesn't work

This app uses native modules that are **not** bundled in the Expo Go app —
`react-native-maps`, `expo-notifications` (push), `expo-secure-store`, and the
Firebase native config (`google-services.json` / `GoogleService-Info.plist`).
Expo Go can only run apps that stick to its built-in native modules, so scanning
the `npx expo start` QR code in Expo Go will fail or crash.

To run on a phone you need a **development build** (a custom dev client) or a
**preview/production build** produced by EAS. `npx expo start` then connects to
_your_ installed build (not Expo Go):

```bash
npx expo start --dev-client       # after installing a development build
# add --tunnel if the phone can't reach your machine over LAN
```

## One-time setup (requires your Expo account)

EAS builds run on Expo's servers, so you must authenticate and link a project:

```bash
npx eas-cli login                 # your Expo account
npx eas-cli init                  # creates the EAS project + writes extra.eas.projectId
```

`eas.json` (committed) already defines three profiles:

| Profile       | Use                                      | Android output   |
| ------------- | ---------------------------------------- | ---------------- |
| `development` | dev client for `expo start --dev-client` | APK (internal)   |
| `preview`     | shareable internal test build            | APK (internal)   |
| `production`  | store submission                         | AAB (app bundle) |

## Build commands

```bash
# Android internal test APK (installable directly on a phone)
npx eas-cli build --platform android --profile preview

# iOS production (App Store); needs Apple credentials via `eas credentials`
npx eas-cli build --platform ios --profile production

# Development build for on-device debugging with the dev client
npx eas-cli build --platform android --profile development
```

## Required secrets / credentials

- **Expo account** — `eas login` (and `eas init` to create the project).
- **Apple / Google signing** — EAS manages these interactively, or run
  `npx eas-cli credentials`.
- **Google Maps API keys** (for `react-native-maps` on native): set separate
  iOS and Android keys in EAS Environment Variables so they are injected at
  build time (see `app.config.js`). Do not commit key values to source.

  ```bash
  eas env:create --environment development --name GOOGLE_MAPS_IOS_API_KEY --value "<ios-key>"
  eas env:create --environment development --name GOOGLE_MAPS_ANDROID_API_KEY --value "<android-key>"
  eas env:create --environment preview --name GOOGLE_MAPS_IOS_API_KEY --value "<ios-key>"
  eas env:create --environment preview --name GOOGLE_MAPS_ANDROID_API_KEY --value "<android-key>"
  eas env:create --environment production --name GOOGLE_MAPS_IOS_API_KEY --value "<ios-key>"
  eas env:create --environment production --name GOOGLE_MAPS_ANDROID_API_KEY --value "<android-key>"
  ```

  You can also add them in the Expo dashboard at:
  **Project → Environment Variables**.

  Restrict the iOS key to **Maps SDK for iOS** and the exact bundle identifier
  `com.bergmanrace.live`. Restrict the Android key to **Maps SDK for Android**,
  package `com.bergmanrace.live`, and the SHA-1 fingerprints for development,
  preview/internal testing, and production/Play Store signing.

  Without the matching platform key, the native build can install but the Google
  map may render blank or show an API-key/restriction error.

- **Firebase**: `google-services.json` and `GoogleService-Info.plist` are already
  in the repo and referenced by `app.json`.

## Data source

Builds default to the **production** BERGMAN API. To produce an offline/demo
build, set `EXPO_PUBLIC_USE_MOCK_DATA=true` (e.g. an `env` block in the chosen
`eas.json` profile).
