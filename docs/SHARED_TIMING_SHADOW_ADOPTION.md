# Shared timing-calculations shadow adoption

## Provenance

- Package: `@race-technology/timing-calculations@0.1.0`
- Shared-core repository: `/Users/vaibhav/Downloads/race-technology-core`
- Shared-core commit: `1f1edde24d506d7d3b2bdbb31cdec56636e6a675`
- Source checksum: `c80da1af302ebe5c7b9cbbe88635ff492132a7e49e880e84d2cecbc12c417156`
- Packed artifact checksum: `49146d45436f48e9699ae0cd7876d5d8694add7c71b5da50cd9faccbde8fac30`
- npm integrity: `sha512-5rn8kvQ0YigxjQbd+fey4sh6XZaiwyLQhV0Rswn7IdfhxcLlVGdUfBTJ8kmovVUVE5ncpMzNUoqdrwJKHDAo0g==`

The dependency is the checked-in packed artifact at `vendor/race-technology-timing-calculations-0.1.0.tgz`. BERGMAN uses the byte-identical artifact. No shared source is copied into either product.

For a later private registry transition, publish the same package under the private `@race-technology` scope, pin the exact version and lockfile integrity, verify the source/artifact checksums in CI, then remove the vendored `file:` dependency in a separately reviewed change.

## Mode

`SHARED_TIMING_CALCULATIONS_MODE=off|shadow`

- Default or invalid value: `off`.
- `off`: shared-core is not loaded and telemetry is not emitted.
- `shadow`: Race Upshot calculates and returns its existing authoritative result, then asynchronously loads shared-core, compares normalized output and records bounded parity telemetry.
- There is no authoritative shared-core mode.

No production environment value was added or changed in this implementation.

## Entry points

The adapter is `packages/live-tracking-contracts/src/shadow-timing-calculations.ts`. Existing functions remain authoritative and call these observers:

- `time.ts`: `shadowNormalizeTimestampUtc`
- `start-timing.ts`: `shadowNormalizeStartConfiguration`, `shadowResolveOfficialAthleteStart`, `shadowProcessStartTimingRead`, `shadowProcessStartPassageRead`
- `snapshot.ts`: `shadowSelectTimingRead`, `shadowCalculateDurations`

The adapter covers timestamp normalization; CHIP/GUN/WAVE resolution; start configuration/read/passage decisions; first/last/auto/pass-number/manual read selection; Swim/T1/Bike/T2/Run/overall durations; and pace calculations. Ranking, terminal statuses, provider ingestion, persistence, Phase-1 ingress, raw-passage processing and UI remain excluded.

## Telemetry

Telemetry is a process-local ring capped at 200 records. It contains product, package version, shared commit/checksum, operation, match flag, hashes of normalized results, difference category and timestamp. Optional event scope and trace IDs are supported; participant identity and raw inputs are not recorded. The optional sink is failure-isolated and no remote store is required.

## Local replay parity

No eligible historical athlete timing export was found in the repository. The available read-only replay corpus is the accepted 25-fixture suite; 17 fixtures enter this package boundary.

| Operation | Compared | Match | Mismatch | Match % |
|---|---:|---:|---:|---:|
| Timestamp | 1 | 1 | 0 | 100% |
| CHIP | 2 | 2 | 0 | 100% |
| GUN | 1 | 1 | 0 | 100% |
| WAVE | 1 | 1 | 0 | 100% |
| Start acceptance | 4 | 4 | 0 | 100% |
| Read selection | 5 | 5 | 0 | 100% |
| Swim | 2 | 2 | 0 | 100% |
| T1 | 2 | 2 | 0 | 100% |
| Bike | 2 | 2 | 0 | 100% |
| T2 | 2 | 2 | 0 | 100% |
| Run | 2 | 2 | 0 | 100% |
| Overall | 2 | 2 | 0 | 100% |
| Pace | 2 | 2 | 0 | 100% |

Operations overlap within fixtures. No organic mismatch was discovered. Deliberate mismatch, shared exception, missing-package/off-mode and telemetry-sink failure are covered by focused tests, and Race Upshot's result remains returned in every case.

## Live Tracking Panel direction

Shareable calculation dependencies are now proven for timestamp display, start-baseline previews, read-decision explanations, repeated/out-of-order passage previews, split-selection previews, and Swim/T1/Bike/T2/Run/overall/pace calculations. Provider access, audit persistence, authorization, correction writes, ranking, statuses and notifications remain product-owned.
