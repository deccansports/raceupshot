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

## Canonical live tracking and Feibot synchronization

Bergman must implement the same canonical-first data path. Web and mobile must
not render directly from a raw Feibot response once a canonical version exists.

1. A per-event durable scheduler requests Feibot updates.
2. Provider rows are normalized against the saved contest, split, passage,
   athlete, and timing-point mappings.
3. Accepted changes are written as an immutable/version-pinned canonical event
   plus participant projections.
4. A canonical change event is published only after the write completes.
5. Connected clients invalidate the affected athlete, participant, leaderboard,
   and active-version queries from that event.
6. HTTP polling remains a bounded recovery path when the stream is unavailable.

The current Race Upshot production cadence is:

- scheduler wake-up: every **60 seconds**;
- Feibot temporary/live result feed: due every **60 seconds**;
- Feibot final-result feed: due every **5 minutes**;
- participant/roster reconciliation: every **5 minutes**;
- canonical publish after a successful fetch: immediate in the same sync job;
- canonical WebSocket notification after the write: immediate;
- selected-athlete canonical recovery polling: every **10 seconds**;
- event participant canonical recovery polling: every **30 seconds**;
- mobile live leaderboard polling: every **5 seconds**;
- general mobile tracking polling: every **12 seconds**;
- displayed live clocks/interpolation: every **1 second**, calculated locally
  from the last accepted canonical timing anchor.

Therefore, under normal conditions a new Feibot split should reach Race Upshot
on the next 60-second provider cycle, followed by canonical publication and an
immediate stream invalidation. This is not a guaranteed 10-second Feibot fetch:
the 10-second interval is only the selected-athlete recovery poll after data is
already canonical.

Feibot protection must also be retained:

- provider result feeds are requested sequentially, never as a burst;
- retryable failures receive at most two retries after the initial request;
- without `Retry-After`, retry delays are 5 seconds and then 10 seconds;
- HTTP 429 enters a minimum 2-minute persisted cooldown, or longer when Feibot
  supplies a bounded `Retry-After` value;
- HTTP 401/403 on an optional feed backs off for 15 minutes;
- failed, denied, empty, or rate-limited reads preserve the last valid canonical
  version and must never clear or regress athlete timing;
- a newer accepted canonical correction may retract an incorrect earlier split
  or finish and must update clients without restarting the app.

Bergman acceptance logging should record provider request time, provider response
time, canonical write completion time, stream receipt time, and UI render time.
This allows measurement of provider-to-canonical and canonical-to-client latency
without confusing the one-second display clock with provider synchronization.

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
