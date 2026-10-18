# Canonical timing engine audit

Date: 2026-10-10 (follow-up validated 2026-10-18)

## Scope and pre-change findings

The audit traced Feibot raw reads and calculated results through normalization, passage grouping, canonical snapshots, leaderboards, and mobile result consumption.

- `packages/timing-core/src/feibot-passage-engine.ts` / `groupFeibotPassages`: raw detections were already retained, sorted by reader time, and grouped by chip, physical timing point, and reader. A later crossing outside the detection window remains a separate passage.
- `packages/timing-core/src/feibot-passage-engine.ts` / `processFeibotAthleteTiming`: the Race Upshot raw engine already advanced an ordered logical sequence and correctly resolved a shared physical timing point from athlete progression. The Feibot-processed branch did not. It mapped every supplied row directly and classified the last unmapped row as `FINISH`. This was the primary premature-finish defect.
- `packages/timing-core/src/index.ts` / `normalizeFeibotCalculatedResultParticipant`: a provider `FINISHED` value or a final row named `FINISH` could promote a participant without validating the configured course sequence.
- `packages/live-tracking-contracts/src/course-normalizer.ts` / `buildLegs`: race-level start and finish flags were already limited to the first and final course boundaries.
- `packages/live-tracking-contracts/src/snapshot.ts` / `eligibleTimingReads`, `resolveCanonicalAthleteState`, and `selectCanonicalTimingRead`: canonical state already required chronological configured evidence, separated transitions, protected official/manual reads by priority, and froze accepted final time. This remains the authoritative result layer.
- `packages/live-tracking-contracts/src/leaderboards.ts`: boards consume canonical resolved status. Unfinished elapsed time is live progress, while official finish time is exposed only for a confirmed final split.
- `lib/feibot-timing-processing.ts` and `lib/canonical-live-tracking.ts`: these orchestrate storage/publication. They do not own finish inference after this correction.
- `cloudflare/canonical-change-hub.ts`: this Durable Object serializes and broadcasts canonical changes; it is not a timing calculator.

## Canonical state machine

The accepted logical sequence is:

`NOT_STARTED -> SWIM -> T1 -> BIKE -> T2 -> RUN -> FINISHED`

Terminal exception states are `DNF`, `DNS`, and `DISQUALIFIED`. Manual terminal status remains authoritative. `FINISHED` is valid only when the configured sequence starts at the configured `START`, contains every required preceding point in chronological order, and ends at the one configured final `FINISH` inside the event window and minimum-finish-gap rule.

An out-of-order or future checkpoint remains raw/auditable but does not advance canonical state. Reprocessing all evidence after a missing read arrives deterministically reconstructs the sequence.

## Changes

- Feibot processed rows are sorted deterministically, matched to the expected logical point, and audited as accepted, duplicate, unexpected, or ineligible.
- Physical-point reuse resolves against the athlete's next expected logical point. A physical UUID alone cannot identify a split.
- Unknown or future logical points no longer fabricate a finish.
- Processed and raw finish passages enforce event windows and optional `minimumFinishGapMs`.
- Provider result normalization defaults to on-course unless a caller supplies and completes the exact configured split sequence.
- Authorized manual overrides remain higher priority than automatic/provider results.
- No raw reads or existing official results are deleted or rewritten by this change.

## 2026-10-18 follow-up hardening

- Raw timing ingestion now rebuilds the logical sequence exclusively from the stored, Feibot-imported contest configuration. A caller can submit reader evidence and clock settings, but cannot redefine split order, pass numbers, physical-point mappings, or the final split.
- Contest sequences are rejected when logical IDs or order values are duplicated, a referenced physical timing point is missing, readers are unassigned for raw ingestion, or the one explicit race-final split is not last.
- Provider roster status alone can no longer promote an athlete to `FINISHED`. Canonical timing evidence or a calculated result that completes the exact configured sequence is required.
- Incremental canonical publication demotes stale provider `FINISHED` state when the authoritative timing audit remains on course.
- Mobile matching separates logical split IDs from physical mat IDs. A physical mat reused by multiple logical splits is accepted only when the Feibot pass/use number identifies the correct occurrence; an ambiguous physical-only read is not displayed as multiple completed splits.
- Mobile race state requires the configured row's explicit `isRaceFinish` marker. A completed section or a leg-boundary label such as Swim Finish or Bike Finish cannot finish the race.

## Regression matrix

- A: Swim Finish cannot finish a triathlon: canonical snapshot test plus processed unmapped-row test.
- B: Bike Finish cannot finish a triathlon: canonical snapshot progression test.
- C: valid Run Finish finishes only after the full sequence: passage and snapshot tests.
- D: a shared physical point maps by progression: passage engine shared `U750` start/finish tests.
- E: duplicate reader bursts collapse into one passage: millisecond passage-grouping test.
- F: missing intermediate evidence does not fabricate a split: processed required-predecessor test.
- G: out-of-order reads reconstruct deterministically: reversed raw input and processed sort tests.
- H: later correction produces the correct state: missing-intermediate replay test.
- I: wrong-contest reads are rejected and retained in raw evidence: rejection test.
- J: reads outside event windows are rejected: historical and post-event tests.
- K: an official final read is not overwritten by a lower-priority later read: canonical read-selection test.
- L: Swim 700 m and Swim Finish on one physical mat resolve by Feibot pass 1 and pass 2.
- M: four bike crossings on one physical mat resolve to Bike Loop 1, Loop 2, Loop 3, and Bike Finish without finishing the race.
- N: the shared Run Split/Run Finish mat finishes only on the configured final pass.
- O: a mobile physical-only read on a shared mat maps to no logical split until passage evidence is present.
- P: a roster-level provider `FINISHED` value without configured final-split evidence remains on course.

## Deployment and data safety

This is application logic only. It requires a server/Worker deployment for backend timing ingestion and an OTA/mobile release for the tracking safeguards. Existing stored records remain valid; replay/rebuild is optional for participants previously promoted by unsafe provider evidence and should be run as a non-destructive canonical recomputation from retained raw/provider data.
