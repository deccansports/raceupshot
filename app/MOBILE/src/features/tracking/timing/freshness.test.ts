import assert from "node:assert/strict";
import test from "node:test";

import {
  hasCanonicalFinishEvidence,
  preferFreshestAthleteResponse,
} from "./freshness";

function split(splitKey: string, order: number, readAt: string) {
  return {
    splitKey,
    order,
    status: "COMPLETED",
    readAt,
    elapsedSeconds: order * 100,
  };
}

test("a stale legacy Bike Finish response cannot regress canonical Run Start", () => {
  const canonical = {
    activeVersion: "2026-08-09T081300.000Z-a1b2c3",
    timingVersion: 24,
    updatedAt: "2026-08-09T08:13:00.000Z",
    participantLive: {
      splits: [
        split("swim_start", 1, "2026-08-09T06:05:49.000Z"),
        split("swim_finish", 2, "2026-08-09T06:34:55.000Z"),
        split("bike_start", 3, "2026-08-09T06:43:47.000Z"),
        split("bike_finish", 4, "2026-08-09T06:59:04.000Z"),
        split("run_start", 5, "2026-08-09T07:13:32.000Z"),
      ],
    },
  };
  const staleLegacy = {
    activeVersion: "2026-08-09T075503.927Z-01a505",
    timingVersion: 23,
    updatedAt: "2026-08-09T07:55:03.927Z",
    participantLive: { splits: canonical.participantLive.splits.slice(0, 4) },
  };
  assert.equal(
    preferFreshestAthleteResponse(canonical, staleLegacy),
    canonical,
  );
});

test("a stale started response cannot regress a canonical finish", () => {
  const finished = {
    activeVersion: "2026-08-09T082000.000Z-a1b2c3",
    timingVersion: 25,
    updatedAt: "2026-08-09T08:20:00.000Z",
    participantLive: {
      status: "FINISHED",
      splits: [
        split("run_start", 5, "2026-08-09T07:13:32.000Z"),
        split("run_finish", 6, "2026-08-09T07:24:07.000Z"),
      ],
    },
  };
  const stale = {
    activeVersion: "2026-08-09T081300.000Z-a1b2c3",
    timingVersion: 24,
    updatedAt: "2026-08-09T08:13:00.000Z",
    participantLive: {
      status: "ON_COURSE",
      splits: [split("run_start", 5, "2026-08-09T07:13:32.000Z")],
    },
  };
  assert.equal(preferFreshestAthleteResponse(finished, stale), finished);
  assert.equal(hasCanonicalFinishEvidence(finished), true);
  assert.equal(hasCanonicalFinishEvidence(stale), false);
});

test("a timestamp-only provider refresh preserves the current object", () => {
  const current = {
    timingVersion: 7,
    updatedAt: "2026-08-25T12:00:00.000Z",
    participantLive: {
      status: "ON_COURSE",
      splits: [split("run_start", 1, "2026-08-25T11:55:00.000Z")],
    },
  };
  const timestampOnly = {
    ...current,
    updatedAt: "2026-08-25T12:00:01.000Z",
  };
  assert.equal(preferFreshestAthleteResponse(current, timestampOnly), current);
});
