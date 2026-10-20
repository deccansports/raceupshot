import { describe, expect, it } from "vitest";
import { resultParticipants, shouldUseCanonicalResultFallback, reconcileProvisionalParticipants } from "../lib/provisional-results";
import type { HubSplit } from "../lib/live-tracking-hub-config";
import type { LiveParticipant } from "../packages/contracts/src";

function participant(participantUid: string, raceStatus: LiveParticipant["raceStatus"], overallRank?: number): LiveParticipant {
  return {
    eventId: "event-1",
    participantUid,
    bib: participantUid,
    displayName: participantUid,
    initials: participantUid.slice(0, 2),
    contestName: "Olympic",
    visibility: "PUBLIC",
    raceStatus,
    overallRank,
    splits: [],
  };
}

describe("provisional public results", () => {
  it("selects canonical finish outcomes and excludes athletes still racing", () => {
    expect(resultParticipants([
      participant("finished-second", "FINISHED", 2),
      participant("dnf", "DNF"),
      participant("running", "RUNNING"),
      participant("finished-first", "FINISHED", 1),
    ]).map((row) => row.participantUid)).toEqual(["finished-first", "finished-second", "dnf"]);
  });

  it("falls back only when timing results are empty, never over verified published results", () => {
    expect(shouldUseCanonicalResultFallback([], "timing-provider")).toBe(true);
    expect(shouldUseCanonicalResultFallback([], "raceupshot")).toBe(true);
    expect(shouldUseCanonicalResultFallback([], "published-results")).toBe(false);
    expect(shouldUseCanonicalResultFallback([participant("finished", "FINISHED")], "timing-provider")).toBe(false);
  });
});

describe("stale canonical finish projection", () => {
  const splits: HubSplit[] = ["start", "bike", "finish"].map((id, order) => ({
    id, name: id, order, isFinalRaceSplit: id === "finish", requiredForProgression: true,
    providerContestUuid: "provider", legId: "race", distanceKm: order, timingPointId: null, passage: 1, cutoffSeconds: null,
  }));
  const config = { splits, contestMappings: [{ contestId: "contest", providerContestUuid: "provider" }] };
  const row = {
    ...participant("a", "STARTED", 3), contestId: "contest",
    splits: splits.map((split, index) => ({
      splitId: split.id, name: split.name, splitTime: "00:01:00",
      officialTimeMs: index * 60_000, status: "ACCEPTED",
    })),
  } as LiveParticipant;
  it("repairs complete accepted evidence without changing canonical ranks", () => {
    const [result] = reconcileProvisionalParticipants([row], config);
    expect(result).toMatchObject({ raceStatus: "FINISHED", overallRank: 3, elapsedTime: "00:02:00.000" });
    expect(row.raceStatus).toBe("STARTED");
  });
  it("does not invent a mandatory split", () => {
    expect(reconcileProvisionalParticipants([{ ...row, splits: row.splits.filter((s) => s.splitId !== "bike") }], config)[0].raceStatus).toBe("STARTED");
  });
  it("allows an explicitly optional missing checkpoint", () => {
    const optional = { ...config, splits: splits.map((s) => ({ ...s, requiredForProgression: s.id !== "bike" })) };
    expect(reconcileProvisionalParticipants([{ ...row, splits: row.splits.filter((s) => s.splitId !== "bike") }], optional)[0].raceStatus).toBe("FINISHED");
  });
  it("preserves terminal rulings and rejects the wrong contest", () => {
    expect(reconcileProvisionalParticipants([{ ...row, raceStatus: "DNF" }], config)[0].raceStatus).toBe("DNF");
    expect(reconcileProvisionalParticipants([{ ...row, contestId: "other" }], config)[0].raceStatus).toBe("STARTED");
  });
  it("rejects a pending finish or reversed elapsed times", () => {
    expect(reconcileProvisionalParticipants([{ ...row, splits: row.splits.map(s => s.splitId === "finish" ? { ...s, status: "PENDING" } : s) }], config)[0].raceStatus).toBe("STARTED");
    expect(reconcileProvisionalParticipants([{ ...row, splits: row.splits.map(s => s.splitId === "finish" ? { ...s, officialTimeMs: 1 } : s) }], config)[0].raceStatus).toBe("STARTED");
  });
});
