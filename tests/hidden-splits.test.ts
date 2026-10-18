import { describe, expect, it } from "vitest";

import { sanitizePublicParticipantSplits } from "../lib/platform-repository";
import { normalizeFinalRaceSplits } from "../lib/live-tracking-hub-config";
import { recalculateAthleteSnapshot } from "../packages/live-tracking-contracts/src/snapshot";
import { normalizeCanonicalCourse } from "../packages/live-tracking-contracts/src/course-normalizer";
import {
  processFeibotAthleteTiming,
  type FeibotProcessedTimingResult,
  type FeibotRawRead,
  type TimingEngineConfiguration,
} from "../packages/timing-core/src";
import type { LiveParticipant } from "../packages/contracts/src";

const baseConfiguration: TimingEngineConfiguration = {
  eventUuid: "event-hidden",
  contestUuid: "contest-hidden",
  timingResultSource: "RACE_UPSHOT_ENGINE",
  resultTimeMode: "CHIP",
  gunStartTimestamp: "2026-10-10T00:00:00.000Z",
  startWindowOpenTimestamp: "2026-10-10T00:00:00.000Z",
  startWindowCloseTimestamp: "2026-10-10T01:00:00.000Z",
  eventEndTimestamp: "2026-10-10T12:00:00.000Z",
  passageGapMs: 2_000,
  readerDetectionTimeoutMs: {},
  sequence: [
    { timingPointKey: "start", timingPointUuid: "START", name: "Start", type: "START", order: 0, required: true, publicVisible: true, readerUuids: ["START"] },
    { timingPointKey: "bike_start", timingPointUuid: "BIKE-START", name: "Bike Start", type: "SPLIT", order: 1, required: false, publicVisible: false, readerUuids: ["BIKE-START"] },
    { timingPointKey: "bike_10", timingPointUuid: "LOOP", name: "Bike 10 KM", type: "SPLIT", order: 2, passage: 1, required: false, publicVisible: false, readerUuids: ["LOOP"] },
    { timingPointKey: "bike_20", timingPointUuid: "LOOP", name: "Bike 20 KM", type: "SPLIT", order: 3, passage: 2, required: true, publicVisible: true, readerUuids: ["LOOP"] },
    { timingPointKey: "bike_30", timingPointUuid: "LOOP", name: "Bike 30 KM", type: "SPLIT", order: 4, passage: 3, required: false, publicVisible: false, readerUuids: ["LOOP"] },
    { timingPointKey: "finish", timingPointUuid: "FINISH", name: "Finish", type: "FINISH", order: 5, required: true, publicVisible: true, readerUuids: ["FINISH"] },
  ],
};

function read(id: string, timingPointUuid: string, minute: number): FeibotRawRead {
  return {
    readId: id,
    eventUuid: baseConfiguration.eventUuid,
    contestUuid: baseConfiguration.contestUuid,
    participantUuid: "athlete-hidden",
    bib: "1001",
    chipCode: "10001",
    timingPointUuid,
    readerUuid: timingPointUuid,
    antennaId: "1",
    rssi: -40,
    readerTimestamp: new Date(Date.parse(baseConfiguration.gunStartTimestamp) + minute * 60_000).toISOString(),
    receivedAt: null,
    source: "CLOUD",
  };
}

const processed = (key: string, point: string, minute: number): FeibotProcessedTimingResult => ({
  timingPointKey: key,
  timingPointUuid: point,
  timingPointName: key,
  readerTimestamp: new Date(Date.parse(baseConfiguration.gunStartTimestamp) + minute * 60_000).toISOString(),
  gunTimeMs: minute * 60_000,
  chipTimeMs: minute * 60_000,
  sectionTimeMs: null,
});

describe("hidden split progression", () => {
  it("accepts a later visible checkpoint when distinct hidden checkpoints have no reads", () => {
    const configuration = {
      ...baseConfiguration,
      sequence: baseConfiguration.sequence.map((point) => point.timingPointKey === "bike_20" ? { ...point, timingPointUuid: "BIKE-20", readerUuids: ["BIKE-20"] } : point),
    };
    const result = processFeibotAthleteTiming({
      configuration,
      rawReads: [read("start", "START", 1), read("bike-20", "BIKE-20", 61), read("finish", "FINISH", 121)],
    });
    expect(result.state).toBe("FINISHED");
    expect(result.officialResults.map((row) => row.timingPointKey)).toEqual(["start", "bike_20", "finish"]);
    expect(result.decisions[1]).toMatchObject({ decision: "ACCEPTED", reason: "accepted_after_optional_checkpoint_skip" });
  });

  it("preserves valid hidden reads and keeps shared-mat passages on their logical splits", () => {
    const result = processFeibotAthleteTiming({
      configuration: baseConfiguration,
      rawReads: [
        read("start", "START", 1), read("bike-start", "BIKE-START", 5),
        read("bike-10", "LOOP", 31), read("bike-20", "LOOP", 61), read("bike-30", "LOOP", 91),
        read("finish", "FINISH", 121),
      ],
    });
    expect(result.state).toBe("FINISHED");
    expect(result.officialResults.map((row) => row.timingPointKey)).toEqual(baseConfiguration.sequence.map((row) => row.timingPointKey));
  });

  it("lets explicit processed split identity skip an optional hidden pass on a shared mat", () => {
    const result = processFeibotAthleteTiming({
      configuration: { ...baseConfiguration, timingResultSource: "FEIBOT_PROCESSED" },
      rawReads: [],
      participantIdentity: { participantUuid: "athlete-hidden", bib: "1001", chipCode: "10001" },
      feibotProcessedResults: [
        processed("start", "START", 1),
        processed("bike_20", "LOOP", 61),
        processed("finish", "FINISH", 121),
      ],
    });
    expect(result.state).toBe("FINISHED");
    expect(result.officialResults.map((row) => row.timingPointKey)).toEqual(["start", "bike_20", "finish"]);
  });

  it("uses a provider passage number to skip a missing hidden pass on a shared raw reader", () => {
    const result = processFeibotAthleteTiming({
      configuration: baseConfiguration,
      rawReads: [
        read("start", "START", 1),
        { ...read("bike-20", "LOOP", 61), passage: 2 },
        read("finish", "FINISH", 121),
      ],
    });
    expect(result.state).toBe("FINISHED");
    expect(result.officialResults.map((row) => row.timingPointKey)).toEqual(["start", "bike_20", "finish"]);
  });

  it("does not skip a hidden checkpoint explicitly retained as mandatory", () => {
    const configuration = {
      ...baseConfiguration,
      sequence: baseConfiguration.sequence.map((point) => point.timingPointKey === "bike_10" ? { ...point, required: true } : point),
    };
    const result = processFeibotAthleteTiming({
      configuration: { ...configuration, timingResultSource: "FEIBOT_PROCESSED" },
      rawReads: [],
      participantIdentity: { participantUuid: "athlete-hidden", bib: "1001", chipCode: "10001" },
      feibotProcessedResults: [processed("start", "START", 1), processed("bike_20", "LOOP", 61), processed("finish", "FINISH", 121)],
    });
    expect(result.state).toBe("WAITING_FOR_SPLIT_2");
    expect(result.officialResults.map((row) => row.timingPointKey)).toEqual(["start"]);
  });

  it("retains a physical finish read for reconciliation when a hidden mandatory checkpoint is missing", () => {
    const configuration = {
      ...baseConfiguration,
      sequence: baseConfiguration.sequence
        .filter((point) => !["bike_start", "bike_30"].includes(point.timingPointKey))
        .map((point) => point.timingPointKey === "bike_10" ? { ...point, required: true } : point),
    };
    const finish = read("finish-pending", "FINISH", 121);
    const result = processFeibotAthleteTiming({
      configuration,
      rawReads: [read("start", "START", 1), finish],
    });
    expect(result.state).toBe("WAITING_FOR_SPLIT_1");
    expect(result.rawReads).toContainEqual(finish);
    expect(result.decisions.at(-1)).toMatchObject({
      decision: "UNEXPECTED_PASSAGE",
      expectedTimingPointKey: "bike_10",
      reason: "required_preceding_timing_point_missing",
    });
  });
});

describe("hidden split public projection", () => {
  it("keeps a provider-hidden legacy checkpoint mandatory unless explicitly optional", () => {
    const course = normalizeCanonicalCourse({
      eventId: "event-hidden",
      buildVersion: "build-hidden",
      source: "feibot_cloud",
      timezone: "UTC",
      contestMappings: [{ providerContestUuid: "contest-hidden", bergmanTicketId: "ticket", raceType: "running", configuredRaceDistanceKm: 40, legDistancesKm: { run: 40 } }],
      timingRules: {
        legs: [{ leg_uuid: "run", contest_uuid: "contest-hidden", leg_name: "Run", order: 1 }],
        splits: [
          { split_uuid: "start", contest_uuid: "contest-hidden", leg_uuid: "run", split_name: "Start", order: 1, distanceFromStartKm: 0, timing_point_uuid: "START", is_start: true },
          { split_uuid: "hidden", contest_uuid: "contest-hidden", leg_uuid: "run", split_name: "Hidden", order: 2, distanceFromStartKm: 20, timing_point_uuid: "LOOP", hidden: true },
          { split_uuid: "finish", contest_uuid: "contest-hidden", leg_uuid: "run", split_name: "Finish", order: 3, distanceFromStartKm: 40, timing_point_uuid: "FINISH", is_finish: true },
        ],
      },
    });
    expect(course.contests[0]?.splits.find((split) => split.providerSplitId === "hidden")).toMatchObject({ publicVisible: false, required: true });
  });

  it.each([
    { visible: true, requiredForProgression: true },
    { visible: true, requiredForProgression: false },
    { visible: false, requiredForProgression: true },
    { visible: false, requiredForProgression: false },
  ])("keeps visibility and mandatory validation independent: %o", (flags) => {
    const normalized = normalizeFinalRaceSplits([
      { id: "start", name: "Start", legId: "bike", order: 0, distanceKm: 0, timingPointId: "START", passage: 1, cutoffSeconds: null, visible: true, requiredForProgression: true },
      { id: "finish", name: "Finish", legId: "bike", order: 1, distanceKm: 40, timingPointId: "FINISH", passage: 1, cutoffSeconds: null, isFinalRaceSplit: true, ...flags },
    ]);
    expect(normalized.at(-1)).toMatchObject({ isFinalRaceSplit: true, ...flags });
  });

  it("rejects conflicting or intermediate race-finish markers", () => {
    const base = [
      { id: "start", name: "Start", legId: "bike", order: 0, distanceKm: 0, timingPointId: "START", passage: 1, cutoffSeconds: null },
      { id: "middle", name: "Middle", legId: "bike", order: 1, distanceKm: 20, timingPointId: "LOOP", passage: 1, cutoffSeconds: null },
      { id: "finish", name: "Finish", legId: "bike", order: 2, distanceKm: 40, timingPointId: "FINISH", passage: 1, cutoffSeconds: null },
    ];
    expect(() => normalizeFinalRaceSplits(base.map((split) => ({ ...split, isFinalRaceSplit: split.id !== "start" })))).toThrow(/multiple final race splits/i);
    expect(() => normalizeFinalRaceSplits(base.map((split) => ({ ...split, isFinalRaceSplit: split.id === "middle" })))).toThrow(/last configured logical checkpoint/i);
  });

  it("targets the next visible split and its cumulative distance", () => {
    const contest = {
      raceType: "cycling",
      totalDistanceKm: 40,
      timezone: "UTC",
      startConfiguration: { mode: "CHIP", gunStartTime: baseConfiguration.gunStartTimestamp },
      splits: [
        { key: "start", displayName: "Start", legType: "bike", order: 0, cumulativeDistanceKm: 0, distanceInLegKm: 0, isStart: true, isRaceStart: true, publicVisible: true, required: true },
        { key: "bike_start", displayName: "Bike Start", legType: "bike", order: 1, cumulativeDistanceKm: 1.6, distanceInLegKm: 1.6, publicVisible: false, required: false },
        { key: "bike_10", displayName: "Bike 10 KM", legType: "bike", order: 2, cumulativeDistanceKm: 11.5, distanceInLegKm: 11.5, publicVisible: false, required: false },
        { key: "bike_20", displayName: "Bike 20 KM", legType: "bike", order: 3, cumulativeDistanceKm: 21.5, distanceInLegKm: 21.5, publicVisible: true, required: true },
        { key: "finish", displayName: "Finish", legType: "bike", order: 4, cumulativeDistanceKm: 40, distanceInLegKm: 40, isFinish: true, isRaceFinish: true, publicVisible: true, required: true },
      ],
      legs: [{ key: "bike", type: "bike", displayName: "Bike", order: 1, startSplitKey: "start", finishSplitKey: "finish", distanceKm: 40 }],
      sections: [], transitions: [], cutoffs: {},
    } as unknown as Parameters<typeof recalculateAthleteSnapshot>[1];
    const startedAt = "2026-10-10T00:01:00.000Z";
    const snapshot = {
      updatedAt: startedAt,
      identity: {},
      raceState: { status: "cycling" },
      startTiming: { officialStartTime: startedAt, chipStartDetectionTime: startedAt, startTimeSource: "CHIP", startTimeLocked: true, acceptedReadId: "start", startStatus: "ON_COURSE", updatedAt: startedAt, startInferenceSource: "reader" },
      reads: { start: { readId: "start", status: "valid", timestamp: startedAt, occurredAt: startedAt, elapsedSeconds: 0 }, bike_start: null, bike_10: null, bike_20: null, finish: null },
      splits: [], calculated: {}, splitRankings: {}, overallRanking: {}, sections: [], location: null,
    } as unknown as Parameters<typeof recalculateAthleteSnapshot>[0];
    const result = recalculateAthleteSnapshot(snapshot, contest, "2026-10-10T00:02:00.000Z");
    expect(result.raceState.resolved?.nextExpectedSplit?.splitKey).toBe("bike_20");
    expect(result.raceState.resolved?.nextSplitDistanceKm).toBe(21.5);
  });

  it("removes hidden rows from public participant output but retains visible rows", () => {
    const participant: LiveParticipant = {
      eventId: "event-hidden", participantUid: "athlete-hidden", bib: "1001", displayName: "Athlete", initials: "A",
      contestId: "contest-hidden", contestName: "Cycling", visibility: "PUBLIC", raceStatus: "STARTED",
      latestTimingPoint: "Bike 10 KM", latestSplitTime: "00:20:00",
      splits: [
        { splitId: "start", name: "Start", splitTime: "00:00:00" },
        { splitId: "bike_10", name: "Bike 10 KM", splitTime: "00:20:00" },
      ],
    };
    const visible = sanitizePublicParticipantSplits(participant, {
      splits: [
        { id: "start", name: "Start", providerContestUuid: "contest-hidden", visible: true },
        { id: "bike_10", name: "Bike 10 KM", providerContestUuid: "contest-hidden", visible: false },
      ],
    });
    expect(visible.splits.map((split) => split.splitId)).toEqual(["start"]);
    expect(visible.latestTimingPoint).toBe("Start");
    expect(visible.latestSplitTime).toBe("00:00:00");
    expect(participant.splits).toHaveLength(2);
  });
});
