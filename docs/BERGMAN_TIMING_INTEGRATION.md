# BERGMAN timing integration guide

## Purpose

This branch publishes Race Upshot's canonical live-timing corrections for review and selective adoption by BERGMAN. It separates physical RFID observations from logical race progression, keeps hidden checkpoints internal, and treats only the configured final logical split as finish evidence.

The implementation is application logic only. It does not migrate or delete timing data, change production configuration, or deploy either product.

## Timing model and implemented changes

### Feibot passage processing

`packages/timing-core/src/feibot-passage-engine.ts` retains every eligible raw read, groups repeated detections into passages, and advances an athlete only through the ordered contest sequence. Passage grouping now includes the provider passage/use number so repeated uses of one mat remain distinct.

Each logical point carries:

- a stable logical split key;
- a physical timing-point UUID and allowed readers;
- a Feibot passage number;
- ordered course position;
- mandatory/optional progression status; and
- public visibility metadata.

The engine accepts the expected logical point, or a later point only when every skipped point is explicitly optional. Missing mandatory predecessors retain the new observation as auditable evidence but do not advance the athlete.

Processed Feibot results follow the same sequence rules as raw reads. A supplied logical split identity is authoritative. An unknown or future split cannot be reclassified as the finish.

### Feibot-imported configuration authority

`lib/feibot-timing-processing.ts` builds ingestion sequences with `authoritativeFeibotTimingSequence`. Caller-supplied sequences are not trusted. The stored Feibot-imported configuration owns logical IDs, ordering, physical mappings, passage numbers, visibility, mandatory status, and final-split designation.

The sequence is rejected when it contains duplicate logical IDs/orders, missing physical points, unassigned readers for raw ingestion, or anything other than exactly one terminal final split.

`lib/feibot-integration.ts` preserves administrator visibility choices during rule refresh, defaults legacy checkpoints to mandatory, understands provider errors carried inside HTTP 200 responses, and invokes recurring cutoff reevaluation even when a poll returns no changed rows.

### Shared physical RFID mats

A physical timing mat may represent several logical checkpoints. The backend resolves it using athlete progression and Feibot passage number. The mobile flow keeps physical IDs separate from logical IDs and refuses an ambiguous physical-only read when the same mat is used more than once.

Examples covered by tests include Swim 700 m / Swim Finish on one mat, multiple bike-loop crossings, and Run Split / Run Finish on one mat. A mat whose hardware type is `FINISH` does not finish the race unless its current logical use is the configured final split.

### Hidden and mandatory checkpoints

Visibility and course validity are independent:

| Public visibility | Mandatory | Behaviour |
| --- | --- | --- |
| Visible | Yes | Shown publicly and required for progression. |
| Visible | No | Shown when read; a later point may skip it. |
| Hidden | Yes | Retained internally and required; never shown publicly. |
| Hidden | No | Retained when read, omitted publicly, and may be skipped. |

Legacy/imported checkpoints default to mandatory unless explicitly configured optional. The admin flow exposes both controls and warns when a hidden checkpoint remains mandatory.

Hidden reads remain in raw evidence, audits, official results, pace calculations, and canonical state. Public participant payloads, canonical cold starts, result details, leaderboards, and mobile race flow remove hidden rows. Canonical ETA selects the next visible split while internal calculation can still use hidden evidence.

### Canonical race progression

The canonical sequence is ordered by the imported logical split configuration. For a triathlon, the normal progression is:

`NOT_STARTED -> SWIM -> T1 -> BIKE -> T2 -> RUN -> FINISHED`

T1 and T2 are derived from accepted boundary reads: Swim Finish to Bike Start, and Bike Finish to Run Start. Completing a sport section does not complete the race. Missing or late evidence can be replayed deterministically because raw observations are retained.

Provider roster status is not finish evidence. A provider-level `FINISHED` value is demoted to on-course until timing evidence completes the configured sequence. Incremental canonical publication also removes a stale finished state when the authoritative audit remains incomplete.

### Finish validation

Only a read matched to the last configured logical split with `isFinalRaceSplit` / `isRaceFinish` can finish the athlete. All mandatory preceding checkpoints must be accepted in chronological order, and event-window and minimum-finish-gap checks must pass.

Swim Finish, Bike Finish, a completed section, a physical mat named Finish, or a roster status cannot independently produce overall `FINISHED`.

### Cutoff and DNF handling

Existing cutoff evaluation calculates deadlines from the applicable start, wave, split, leg, and overall rules. With strict final cutoff enabled, an incomplete athlete moves through `CUTOFF_PENDING` and then `DNF` after the reconciliation period.

`reevaluateEventTimingCutoffs` runs from the recurring Feibot live-sync alarm, including polls with no new reads. Changed states are persisted and incrementally republished to canonical KV without requiring an open browser or another RFID observation.

### Public web, leaderboard, and mobile behaviour

`lib/platform-repository.ts` projects public participants without hidden splits and replaces a hidden latest-point label with the latest visible point. `app/api/v1/events/[eventId]/canonical/route.ts` applies the same projection to cold canonical responses. Split leaderboards exclude hidden splits.

The mobile timing patch filters hidden definitions, maps shared mats only with unambiguous passage evidence, propagates the explicit final-race marker, and removes section-completion as a finish fallback. The patch is stored at `docs/patches/race-upshot-mobile-live-timing.patch` because the mobile submodule URL currently returns `Repository not found`; see Known limitations.

## Modified source files and responsibilities

### Directly reusable packages

- `packages/timing-core/src/feibot-passage-engine.ts`: raw/processed passage grouping, optional-split skipping, shared-mat resolution, and exact finish validation.
- `packages/timing-core/src/index.ts`: prevents roster/provider status from fabricating a finish.
- `packages/live-tracking-contracts/src/contracts.ts`: public visibility fields on canonical split definitions and rows.
- `packages/live-tracking-contracts/src/course-normalizer.ts`: imports visibility and mandatory status independently.
- `packages/live-tracking-contracts/src/snapshot.ts`: persists visibility and targets the next visible checkpoint for ETA.
- `packages/live-tracking-contracts/src/leaderboards.ts`: excludes hidden split rankings.

BERGMAN can reuse these packages directly when its canonical contract matches. If BERGMAN vendors packaged tarballs, regenerate and version those artifacts from this source rather than copying generated bundles from a deployment.

### Race Upshot orchestration requiring adaptation

- `lib/feibot-timing-processing.ts`: Race Upshot KV keys, audit persistence, canonical publication, and scheduled cutoff sweep.
- `lib/feibot-integration.ts`: Feibot polling, rule merge, retry/error semantics, and cutoff-sweep invocation.
- `lib/canonical-live-tracking.ts`: reconciliation between provider rows and authoritative audit state.
- `lib/live-tracking-hub-config.ts` and `lib/live-tracking-hub-schema.ts`: stored event configuration and safe legacy defaults.
- `components/live-tracking-hub.tsx`: admin visibility/mandatory controls.
- `lib/platform-repository.ts`: public split projection.
- `app/api/v1/admin/events/[eventId]/timing/route.ts`: passage-number ingestion contract.
- `app/api/v1/events/[eventId]/canonical/route.ts`: public canonical projection.
- `app/api/v1/events/[eventId]/course/route.ts`: rapid revalidation of operational split visibility.
- `lib/timing-provider-response.ts`: semantic handling of provider errors, including error bodies returned with HTTP 200.

BERGMAN should adapt storage keys, scheduler ownership, event/contest lookup, canonical publication, authorization, and public API envelopes while preserving the state-machine and evidence rules.

### Mobile reference patch

- `src/features/tracking/mappers.ts`: hidden filtering plus logical/physical ID, passage, and final-marker mapping.
- `src/features/tracking/timing/canonicalRaceFlow.ts`: shared-mat disambiguation and explicit final marker.
- `src/features/tracking/timing/raceSections.ts`: passage-aware physical-mat matching.
- `src/features/tracking/timing/canonicalRaceState.ts`: finish only from explicit final evidence.
- Associated mobile regression tests are included in the patch.

## Data and configuration changes

No database migration is required. Existing JSON/KV timing configuration gains optional fields:

- `visible` / canonical `publicVisible` (default `true`);
- `requiredForProgression` / canonical `required` (legacy default `true`);
- `passage` / `passNumber` for logical uses of a physical point; and
- `isFinalRaceSplit` / `isRaceFinish` for the one terminal logical split.

Existing raw reads and official timing results are preserved. Previously misclassified athletes can be corrected by a non-destructive timing/canonical replay from retained evidence.

## BERGMAN compatibility test matrix

BERGMAN should run equivalent tests for:

1. Hidden and visible checkpoints in all mandatory/optional combinations.
2. Consecutive optional hidden checkpoints followed by a visible read.
3. A hidden mandatory checkpoint blocking later progression and finish.
4. Shared-mat swim, bike, and run passages resolved by logical ID and pass number.
5. An ambiguous physical-only shared-mat read completing no logical split.
6. Duplicate reader bursts collapsing to one passage while exit/re-entry produces a later passage.
7. Swim Finish and Bike Finish never completing the full race.
8. Final Run Finish completing only after all mandatory predecessors.
9. T1 and T2 calculation from accepted boundary timestamps.
10. Out-of-order, late, corrected, and wrong-contest reads remaining auditable and deterministic.
11. Event-window and minimum-finish-gap rejection.
12. Provider roster `FINISHED` without final evidence remaining on course.
13. Cutoff transition from on-course to `CUTOFF_PENDING` to `DNF` without new reads.
14. Canonical ETA skipping hidden presentation points.
15. Hidden rows absent from public APIs, leaderboards, result detail, and mobile UI.
16. Provider error objects inside HTTP 200 responses, including no-results, no-changes, rate-limit, authorization, and service-unavailable outcomes.

Race Upshot reference coverage is in `tests/feibot-passage-engine.test.ts`, `tests/feibot-shared-finish-mat.test.ts`, `tests/hidden-splits.test.ts`, `tests/canonical-race-state.test.ts`, `tests/feibot-participant-normalization.test.ts`, `tests/race-finish-cutoff-authority.test.ts`, `tests/timing-provider-response.test.ts`, and the mobile tests represented by the patch.

## Known limitations and unresolved issues

- The configured `apps/mobile` submodule URL (`https://github.com/vaibhav6577/race-upshot-mobile.git`) returned `Repository not found` during publication. The mobile commit was therefore not referenced from the root repository; its exact reviewed diff is included as `docs/patches/race-upshot-mobile-live-timing.patch` so this branch remains self-contained and cloneable.
- Raw shared-mat evidence without a provider logical key or pass number is intentionally ambiguous and will not advance more than one logical occurrence. Provider mapping must supply this identity.
- A precise timing result still depends on synchronized reader clocks and correct Feibot contest/split mappings.
- Legacy records falsely promoted to finished are not rewritten automatically; use non-destructive replay/rebuild after reviewing event configuration.
- The scheduled cutoff sweep uses Race Upshot's existing per-event live-sync alarm. BERGMAN must connect the equivalent evaluator to its own always-on scheduler.
- No production deployment or merge is part of this branch.
