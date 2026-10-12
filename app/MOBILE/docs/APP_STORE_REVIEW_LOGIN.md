# Apple App Review Login

The application uses email OTP authentication.

For Apple App Review, please use:

Email:
applereview@bergmantri.com

OTP:
123456

This fixed OTP works ONLY for the dedicated Apple Review account and is disabled for all other users.

Steps:

1. Open the app.
2. Tap Sign In.
3. Enter applereview@bergmantri.com.
4. Enter OTP 123456.
5. Explore Events.
6. Open BERGMAN BENGALURU 2026.
7. Test registration, athlete profile, live tracking, results, and broadcast.

Live timing and broadcast features are only active during live events. Outside event days, demonstration data will be shown where available.

## Required production flags

- Backend: `APPLE_REVIEW_LOGIN_ENABLED=true`
- Mobile build: `EXPO_PUBLIC_APPLE_REVIEW_LOGIN_ENABLED=true`
