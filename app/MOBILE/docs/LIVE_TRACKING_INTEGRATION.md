# Live Tracking Integration Guide

This document summarizes the BERGMAN live tracking integration used by the app and its backend contracts.

## Overview

Live tracking is split into two modes:

- Live events: use KV-backed participant indices and live positions.
- Completed events: use official results data and do not call the live tracking endpoint.

The app should switch behavior automatically based on the event status.

## Event States and Data Sources

### Upcoming

Use the event details payload and show:

- Event information
- Track entry point
- My Account

### Live

Use:

- GET /api/events/{eventId}/tracking
- live:event:{eventId}:participant:index
- live:event:{eventId}:participant:{participantUuid}

Show:

- Live map
- Live leaderboard
- Athlete search
- Live athlete cards

### Completed

Do not call /api/events/{eventId}/tracking.

Use:

- results:{eventId}
- GET /api/results/{eventId}
- user:{athleteUid}

Show:

- Official Results
- Athlete Result Modal
- Splits
- Chip Time
- Rankings
- Certificates
- Athlete Profile

Hide:

- Live Sync
- Tracking cards
- Live map marker
- Live Athlete Modal
- Track page

## Frontend Polling Guidance

- Live positions: poll every 5 seconds
- Live leaderboard: poll every 10 seconds
- Athlete modal: poll only while open
- Search: debounce by 200ms

Do not poll completed-event live tracking endpoints.

## Timing Ingest

Timing systems should POST to:

- POST /timing/ingest

Payload fields:

- eventId
- bibNumber
- timestamp
- lat
- lng
- speed
- distance
- checkpoint

Example checkpoints:

- SWIM_START
- SWIM_FINISH
- TRANSITION_1
- BIKE_10KM
- BIKE_20KM
- BIKE_30KM
- BIKE_40KM
- TRANSITION_2
- RUN_5KM
- RUN_10KM
- FINISH

## Sync Webhook

Firestore registration writes should sync through:

- POST /sync/webhook
- header: x-api-key

Typical payload types:

- participant
- event
- user
- registration

## Admin Dashboard

The admin dashboard should expose a live sync feed tab with:

- Firestore-triggered sync events
- Sync status
- Error monitoring
- KV cache update visibility

## Recommended UI Behavior

### Live Event

Show:

- Event Info
- Track
- Leaderboard
- My Account

### Completed Event

Show:

- Event Info
- Results
- Leaderboard
- My Account

### Athlete Search

- Live event: search live participants
- Completed event: search official results

## Notes

- Completed events must never display the live tracking UI.
- Finished-athlete detail should render the official result modal, not the live tracking modal.
- Keep all live-tracking requests behind event status checks.
