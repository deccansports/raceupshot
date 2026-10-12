import { describe, expect, it } from "vitest";

import { recalculateAthleteSnapshot } from "../packages/live-tracking-contracts/src/snapshot";

describe("configured canonical race finish", () => {
  it("does not finish on an intermediate run-finish-labelled boundary", () => {
    const keys = ["swim_start", "swim_finish", "bike_start", "bike_finish", "run_start", "run_finish", "race_finish"];
    const contest = {
      providerContestUuid: "contest-1",
      raceType: "triathlon",
      totalDistanceKm: 52,
      timezone: "UTC",
      startConfiguration: { mode: "CHIP" },
      splits: keys.map((key, index) => ({
        key,
        displayName: key.replaceAll("_", " "),
        order: index + 1,
        legType: index < 2 ? "swim" : index < 4 ? "bike" : "run",
        cumulativeDistanceKm: index,
        distanceInLegKm: index,
        required: true,
        isStart: key === "swim_start",
        isRaceStart: key === "swim_start",
        // Legacy provider data may label an intermediate boundary as Finish.
        isFinish: key === "run_finish" || key === "race_finish",
        isRaceFinish: key === "race_finish",
      })),
      legs: [],
      transitions: [],
      sections: [],
      cutoffs: {},
    } as unknown as Parameters<typeof recalculateAthleteSnapshot>[1];
    const base = Date.parse("2026-08-08T09:00:00.000Z");
    const read = (key: string, index: number) => ({
      readId: key,
      status: "official",
      elapsedSeconds: index * 600,
      timestamp: new Date(base + index * 600_000).toISOString(),
      occurredAt: new Date(base + index * 600_000).toISOString(),
    });
    const reads = Object.fromEntries(keys.map((key, index) => [
      key,
      key === "race_finish" ? null : read(key, index),
    ]));
    const snapshot = {
      identity: { bib: "1001" },
      updatedAt: "2026-08-08T10:30:00.000Z",
      raceState: { status: "running" },
      reads,
      splits: [],
      calculated: {},
      splitRankings: {},
      overallRanking: {},
      sections: [],
      location: null,
    } as unknown as Parameters<typeof recalculateAthleteSnapshot>[0];

    const result = recalculateAthleteSnapshot(snapshot, contest, "2026-08-08T10:30:00.000Z");
    expect(result.raceState.status).not.toBe("finished");
    expect(result.raceState.resolved?.status).not.toBe("FINISHED");
    expect(result.calculated.overallSeconds).toBeNull();
  });
});
