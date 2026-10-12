# BERGMAN Mobile API

Version: 1.0

## Base URL

https://api-mobile.bergmantri.com

All mobile requests must go through this API.

The mobile API owns:

• Authentication
• Athlete Account
• Dashboard
• Registrations
• Watchlist
• Notifications
• Certificates
• Settings
• Profile

Public live race data is proxied to the Live Tracking Worker.

---------------------------------------
PUBLIC ENDPOINTS
---------------------------------------

GET /

Returns

{
  "success": true,
  "service": "bergman-mobile-api",
  "message": "BERGMAN Mobile API"
}

---------------------------------------

GET /health

Returns

{
  "success": true,
  "data": {
    "ok": true,
    "service": "bergman-mobile-api",
    "env": "production"
  }
}

---------------------------------------
  PUBLIC RESULTS ENDPOINTS
  ---------------------------------------

  These endpoints are public and read directly from KV key results:{eventId}.

  GET /api/results/{eventId}

  Returns the complete uploaded results for the event.

  GET /api/results/{eventId}/{bib}

  Returns a single athlete result.

  GET /api/results/{eventId}/search?q=

  Searches by bib, name, email, and city.

  GET /api/results/{eventId}/leaderboard

  Supports query filters:

  - gender=Male
  - category=16-30
  - status=FINISHED

  ---------------------------------------
AUTHENTICATION
---------------------------------------

No Bearer token required.

POST /api/send-email-otp

Request

{
  "email":"info@bergmantri.com"
}

Response

{
  "success":true
}

---------------------------------------

POST /api/verify-email-otp

Request

{
  "email":"info@bergmantri.com",
  "otp":"123456"
}

Response

{
  "success":true,
  "accessToken":"...",
  "refreshToken":"...",
  "athlete":{}
}

---------------------------------------

POST /api/send-phone-otp

---------------------------------------

POST /api/verify-phone-otp

---------------------------------------

POST /api/logout

---------------------------------------

POST /api/refresh-token

---------------------------------------

Everything below requires

Authorization: Bearer Firebase_ID_Token

---------------------------------------
PROFILE
---------------------------------------

GET

/api/athletes/profile

PATCH

/api/athletes/profile

DELETE

/api/athletes/profile/photo

POST

/api/athletes/profile/photo

---------------------------------------
REGISTRATIONS
---------------------------------------

GET

/api/athletes/registrations

---------------------------------------
EVENT PRIVACY
---------------------------------------

PATCH

/api/events/{eventId}/registration/privacy

Body

{
    "liveTrackingVisibility":"PUBLIC"
}

Possible values

PUBLIC

PRIVATE

ANONYMOUS

---------------------------------------
DASHBOARD
---------------------------------------

GET

/api/dashboard

KV read contract:

- Profile/account: `user:{uid}:profile`
- Canonical user fallback: `user:{uid}`
- Upcoming/active registrations: `user:{uid}:events:index`
- Notifications: `user:{uid}:notifications`
- Certificates: `user:{uid}:certificates`

---------------------------------------
NOTIFICATIONS
---------------------------------------

GET

/api/notifications

PATCH

/api/notifications

---------------------------------------
WATCHLIST
---------------------------------------

GET

/api/watchlist

POST

/api/watchlist

DELETE

/api/watchlist/{athleteId}

---------------------------------------
CERTIFICATES
---------------------------------------

GET

/api/certificates

---------------------------------------
SETTINGS
---------------------------------------

GET

/api/settings

PATCH

/api/settings

---------------------------------------
PUBLIC LIVE TRACKING
---------------------------------------

These endpoints DO NOT require authentication.

The mobile API simply proxies them to

https://api.bergmantri.com/v1/events

GET

/api/live/events

Returns all live events.

---------------------------------------

GET

/api/live/events/{eventId}

Returns public event information.

---------------------------------------

GET

/api/live/events/{eventId}/leaderboard

Returns leaderboard.

---------------------------------------

GET

/api/live/events/{eventId}/map

Returns course map.

---------------------------------------

GET

/api/live/events/{eventId}/search

Query

q=

mode=name

mode=bib

---------------------------------------
RESPONSE FORMAT
---------------------------------------

Successful response

{
  "success":true,
  "data":{}
}

---------------------------------------

Error response

{
  "success":false,
  "message":"Unauthorized"
}

---------------------------------------
HTTP Status Codes
---------------------------------------

200 OK

201 Created

400 Bad Request

401 Unauthorized

403 Forbidden

404 Not Found

500 Internal Server Error

---------------------------------------
ARCHITECTURE
---------------------------------------

Mobile App

↓

api-mobile.bergmantri.com

↓

Account APIs
Dashboard
Profile
Registrations
Notifications
Watchlist
Certificates
Settings

↓

Live Tracking Proxy

↓

api.bergmantri.com/v1/events

↓

LIVE_TRACKING_KV

---------------------------------------

The mobile application must never access Firestore directly.

The mobile application must never use the old Next.js API routes.

All requests must go through

https://api-mobile.bergmantri.com

except the mobile worker internally proxies live-tracking requests to

https://api.bergmantri.com/v1/events

The mobile application must not contain any hardcoded bergmantri.com API URLs other than the mobile API base URL.
