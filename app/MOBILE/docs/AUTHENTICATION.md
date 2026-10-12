# BERGMAN Race — Authentication Architecture

Status: Implemented end-to-end with **mocked responses** (Milestone 4 · Part 1). Real
endpoints connect by filling `AUTH_ROUTES` — no other changes required.
Scope: Official native mobile application only

## Layered flow

```text
Screen (features/auth/components/LoginScreen)
  ↓
Feature Hook (features/auth/hooks/useAuth)
  ↓
Repository (features/auth/repository/authRepository)  ← persists tokens, maps to AuthUser
  ↓
API Client (core/services/auth/authService → AuthApi)  ← mockAuthApi now / restAuthApi when configured
  ↓
BERGMAN Backend (OTP + SimpleJWT)
```

BERGMAN uses the **existing backend authentication**. The mobile app is a pure
client of those endpoints. This document defines how the app authenticates,
stores tokens, refreshes them, attaches them to requests, and supports guest mode.

## 1. Method

Authentication is **passwordless OTP** with **SimpleJWT** tokens:

- Passwordless Email OTP
- Passwordless Mobile OTP
- SimpleJWT **access** token (short-lived)
- SimpleJWT **refresh** token (long-lived)

Explicitly out of scope (must NOT be implemented):

- Firebase Authentication
- Email/password authentication
- Google Sign-In
- Apple Sign-In

## 2. Flows

### 2.1 Request OTP

1. User enters email or mobile number.
2. App calls the backend "request OTP" endpoint for the chosen channel.
3. Backend sends a one-time code; app moves to the verification step.

### 2.2 Verify OTP → tokens

1. User enters the OTP code.
2. App calls the backend "verify OTP" endpoint with the identifier + code.
3. On success the backend returns `{ access, refresh }` (SimpleJWT).
4. App stores tokens in Expo Secure Store and marks the session authenticated.

### 2.3 Refresh

1. When an access token is expired/near-expiry, the app posts the refresh token
   to the SimpleJWT refresh endpoint to obtain a new access token.
2. Refresh is single-flight: concurrent 401s share one in-flight refresh.
3. If refresh fails (expired/invalid refresh token), the app clears tokens and
   returns athlete-only flows to login while preserving public/guest context.

### 2.4 Logout

- Clear all tokens from Secure Store and reset the session to guest.

## 3. Token Storage (Expo Secure Store)

Only tokens and token metadata are stored — never profile data or payloads.

Stored values (`core/services/auth/secureTokenStore.ts`):

- `accessToken`
- `refreshToken`
- `accessTokenExpiresAt` (epoch ms, when derivable)

Helpers: `getAccessToken`, `getRefreshToken`, `getTokens`, `setTokens`,
`clearTokens`, `isAccessTokenExpired(skewMs)`.

## 4. Request Authorization

- The Axios request interceptor (`core/services/api/interceptors/authInterceptor.ts`)
  injects `Authorization: Bearer <access>` from Secure Store on every request.
- Raw tokens never reach screen components; only the API client reads them.

## 5. Automatic Refresh

- The response interceptor (`core/services/api/interceptors/refreshInterceptor.ts`)
  intercepts `401` responses on authenticated requests.
- It performs a **single-flight** refresh via `authService.refresh()`, updates the
  stored access token, and retries the original request once.
- The refresh call uses a **bare Axios instance** (not the authenticated client)
  so it never recurses through the auth/refresh interceptors.
- On refresh failure it clears tokens and signals auth failure (session → guest).

## 6. Session State

`core/store/session.store.ts` holds session metadata only:

- `status`: `bootstrapping` → `authenticated` | `guest`
- `athleteId` (resolved from the profile endpoint after login)

At startup, `useSessionBootstrap` reads Secure Store: a present, valid token
bootstraps an authenticated session; otherwise guest.

## 7. Guest Mode

- All public features (events, live tracking, leaderboards, athlete search,
  course maps, watchlist) remain fully usable without login.
- Only athlete-specific flows (my events, personal results/certificates, profile
  settings) require authentication.
- On auth expiration, only athlete-only flows return to login; public context is
  preserved.

## 8. Client Abstraction (code seam)

- `core/services/auth/authTypes.ts` — `OtpChannel`, request/verify inputs, `AuthTokens`.
- `core/services/auth/authService.ts` — typed contract:
  `requestOtp`, `verifyOtp`, `refresh`, `logout`.
- Screens/features call `authService` (never Axios directly). This isolates the
  OTP + SimpleJWT integration behind one module.

## 9. Integration Status & Pending Items

Implemented now (mock-backed, full flow works):

- OTP login screen with Email/Mobile channels (React Hook Form + Zod validation).
- Request OTP → verify OTP → SimpleJWT tokens (fabricated by `mockAuthApi`).
- Token persistence in Expo Secure Store (access/refresh/expiry).
- Authorization header injection + single-flight refresh-on-401.
- Session store, guest-mode bootstrap, and logout.
- Profile reflects authenticated vs guest state.

Swap to the real backend by populating `AUTH_ROUTES` in
`core/services/auth/authService.ts`; `authService` then uses `restAuthApi`
automatically. Repository, hook, and screens are unchanged.

Pending the API contract:

- Exact OTP request/verify endpoint paths and payload shapes.
- SimpleJWT refresh endpoint path and response shape.
- Access-token lifetime (to compute `accessTokenExpiresAt`).
- Rate-limit/resend rules and error codes for OTP.

While `AUTH_ROUTES` are empty the app uses mocked responses (any valid
identifier + any 6-digit code signs in). No real endpoints are called.
