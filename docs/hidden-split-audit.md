# Hidden split audit

Date: 2026-10-18

## Findings

- Admin configuration already stored `visible`, and the public timing configuration removed hidden split definitions.
- Canonical estimation still selected the immediately following configured split, even when it was hidden.
- Raw and Feibot-processed timing progression required every configured split, so a missing hidden checkpoint could block a later visible checkpoint.
- Canonical split leaderboards included every ranking-enabled split without checking public visibility.
- Public participant payloads could still contain hidden timing rows even though their timing configuration was filtered.
- Visibility and mandatory course compliance were represented by one implicit behavior instead of independent settings.
- The public canonical cold-start endpoint and direct historical result detail bypassed the participant projection filter.
- Cutoff state advanced only while timing ingestion or a request recalculated state; no-read CUTOFF_PENDING → DNF transitions were not persisted by the recurring server process.

## Corrected behavior

- `visible` controls only public presentation, ETA targets, tracker rows, mobile race flow, and split leaderboards.
- `requiredForProgression` independently controls official sequence and safety compliance. Legacy splits default to mandatory, matching their pre-flag behavior; only an explicit administrator/provider setting makes one optional.
- Visibility toggles never modify mandatory status. The admin shows a warning when a checkpoint is both hidden and mandatory.
- The configured final logical split alone owns finish detection. Its presentation flags remain independent; accepting it still requires an actual final read.
- Missing optional checkpoints can be skipped when a later configured checkpoint supplies unambiguous logical evidence.
- Hidden reads that exist remain in raw evidence, timing audits, official timing results, and canonical calculations.
- Shared physical timing points remain separate from logical visibility. Explicit provider split identity or provider passage number resolves a later shared-mat occurrence. Without either, the engine remains conservative because a physical UUID alone cannot distinguish two laps.
- Canonical ETA and distance-to-next-split select the next visible checkpoint while retaining hidden reads for internal pace and distance calculations.
- Public web/mobile participant projections, canonical cold starts, leaderboards, and historical result details remove hidden rows and replace a hidden latest checkpoint with the latest visible checkpoint.
- Course/timing configuration responses revalidate within five seconds after an admin visibility change.
- The existing per-event Durable Object alarm now re-evaluates cutoff state on every live-sync cycle even when Feibot returns no changed rows. It persists and publishes CUTOFF_PENDING/DNF changes without a browser or RFID trigger.

## Regression coverage

- Missing consecutive hidden checkpoints do not block the next visible checkpoint.
- Valid hidden reads are preserved internally.
- Processed shared-mat reads skip an optional hidden pass using logical split identity.
- Raw shared-mat reads skip an optional hidden pass when Feibot supplies the passage number.
- A hidden checkpoint explicitly marked mandatory still blocks completion when missing.
- ETA skips consecutive hidden checkpoints and exposes the visible checkpoint's cumulative distance.
- Public participant output omits hidden rows without mutating the stored participant.
- All four visibility/mandatory combinations remain unchanged by normalization, including hidden mandatory checkpoints.
