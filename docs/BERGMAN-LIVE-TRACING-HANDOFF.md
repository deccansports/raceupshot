# Bergman live-tracing handoff

Please review and integrate branch `feature/live-timing-bergman-sync` from
`deccansports/race-upshot`.

## Web and backend

- Review commit `61bbeaa`.
- Contest mapping is authoritative. A Race Upshot ticket mapped to a Feibot
  contest must automatically receive that contest's canonical participants,
  split flow, finisher eligibility, and notification grouping.
- For the current test event, verify `Test 123` mapped to Feibot contest
  `Olympic Triathlon` (`3i47riSw`) shows all five canonical finishers under
  `Test 123` after refreshing Finisher Notification Tracing.
- Canonical finish records preserve the provider contest UUID and name for
  audit, but use the mapped Race Upshot ticket for notification identity.
- Canonical split durations use seconds in published results. Triathlon
  eligibility requires positive SWIM, T1, BIKE, T2, and RUN durations.
- Live email and WhatsApp delivery must remain gated until the approved
  Bergtecno template, AiSensy campaign, event switches, and server-side live
  sending flag are configured.

## Mobile application

The configured mobile Git remote was unavailable during handoff. Apply the
two patches in `docs/mobile-live-tracking-patches` in filename order to the
mobile repository from base commit `5301689`.

The mobile review must cover:

- one marker per tracked athlete, always projected onto course geometry;
- no map remount or viewport refit when changing the selected athlete;
- canonical split updates appearing without closing and reopening the app;
- elapsed clocks continuing when athletes are changed or re-added;
- T1/T2 visible only when reached, with live transition elapsed time;
- corrected finish state, finish prediction, elevation position, and cutoff;
- stable search input without keyboard reopen/close loops;
- canonical corrections allowed to retract a previously mistaken finish;
- device registration and refresh behavior for split push notifications.

## Verification evidence

- Production Worker version: `d63f4846-366a-43b5-b715-afee6ae019c6`.
- Production health endpoint returned healthy after deployment.
- Web/backend notification tests: 26 passed.
- Root TypeScript check and production build passed.
- Mobile TypeScript check passed.
- The mobile repository has no valid unified test script. Its source-contract
  suite contains stale text-pattern assertions and must be aligned with the
  current implementation before treating it as a release gate.
