import { describe, expect, it } from "vitest";
import type { LiveParticipant } from "@/packages/contracts/src";
import { canonicalFinisherResultRecord } from "@/lib/canonical-finisher-publication";
import { defaultLiveTrackingHubConfig } from "@/lib/live-tracking-hub-config";

describe("canonical finisher result publication", () => {
  it("publishes a stable finished result from an accepted terminal split even before stored race status catches up", () => {
    const config = {
      ...defaultLiveTrackingHubConfig("event-1"),
      legs: [{ id: "run", name: "Run", type: "RUN" as const, order: 1, distanceKm: 10, cutoffSeconds: null }],
      splits: [
        { id: "start", name: "Start", legId: "run", order: 1, distanceKm: 0, timingPointId: "start", passage: 1, cutoffSeconds: null, isFinalRaceSplit: false, importedName: null, visible: true },
        { id: "finish", name: "Race Finish", legId: "run", order: 2, distanceKm: 10, timingPointId: "finish", passage: 1, cutoffSeconds: null, isFinalRaceSplit: true, importedName: null, visible: true },
      ],
    };
    const participant = {
      eventId: "event-1", participantUid: "provider-1002", bib: "1002", displayName: "Vb1", initials: "VB",
      contestId: "contest-1", contestName: "Olympic Triathlon", visibility: "PUBLIC", raceStatus: "STARTED",
      splits: [
        { splitId: "start", name: "Start", splitTime: "00:00:00.000", officialTimeMs: 0, sectionTimeMs: 0 },
        { splitId: "finish", name: "Race Finish", splitTime: "02:57:24.000", officialTimeMs: 10_644_000, chipTimeMs: 10_644_000, sectionTimeMs: 10_644_000, readerTimestamp: "2026-10-19T14:42:57.000Z" },
      ],
    } satisfies LiveParticipant;

    expect(canonicalFinisherResultRecord(participant, config, { email: "vb1@example.com", mobile: "+919999999999" })).toMatchObject({
      id: "canonical-provider-1002",
      notificationSourceId: "provider-1002",
      status: "FINISHED",
      published: true,
      overallTime: 10_644,
      finishTime: "02:57:24.000",
      finishTimeOfDay: "2026-10-19T14:42:57.000Z",
      email: "vb1@example.com",
    });
  });

  it("projects complete canonical triathlon legs and keeps result split time units in seconds", () => {
    const config = {
      ...defaultLiveTrackingHubConfig("event-1"),
      contestMappings: [{ contestId: "Test 123", providerContestUuid: "contest-1" }],
      splits: [{ id: "finish", name: "Race Finish", legId: "run", order: 8, distanceKm: 51.5, timingPointId: "finish", passage: 1, cutoffSeconds: null, isFinalRaceSplit: true, importedName: null, visible: true }],
    };
    const times = [
      ["swim-start", "Swim Start", 0], ["swim-finish", "Swim Finish", 1_694_000],
      ["bike-start", "Bike Start", 2_518_000], ["bike-finish", "Bike Finish", 5_705_000],
      ["run-start", "Run Start", 6_422_000], ["finish", "Race Finish", 10_644_000],
    ] as const;
    const participant = {
      eventId: "event-1", participantUid: "1aqMW9ry", bib: "1002", displayName: "Vb1", initials: "VB",
      contestId: "contest-1", contestName: "Olympic Triathlon", visibility: "PUBLIC", raceStatus: "STARTED",
      splits: times.map(([splitId, name, officialTimeMs]) => ({ splitId, name, splitTime: "00:00:00.000", officialTimeMs, chipTimeMs: officialTimeMs, readerTimestamp: splitId === "finish" ? "2026-10-19T14:42:57.000Z" : undefined })),
    } satisfies LiveParticipant;
    const record = canonicalFinisherResultRecord(participant, config)!;
    expect(record).toMatchObject({ category: "Test 123", contestId: "Test 123", providerContestUuid: "contest-1", providerContestName: "Olympic Triathlon" });
    expect(record.legTimes).toEqual([
      { name: "SWIM", time: 1_694 }, { name: "T1", time: 824 }, { name: "BIKE", time: 3_187 }, { name: "T2", time: 717 }, { name: "RUN", time: 4_222 },
    ]);
    expect(record.splits).toEqual(expect.arrayContaining([expect.objectContaining({ name: "Race Finish", time: 10_644, officialTimeMs: 10_644_000 })]));
  });
});
