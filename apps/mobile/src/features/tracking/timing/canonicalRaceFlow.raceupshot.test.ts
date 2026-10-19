import { expect, test } from "vitest";

import type { AthleteModalResponse } from "@/core/types";
import { buildCanonicalRaceFlow } from "./canonicalRaceFlow";

test("groups Race Upshot saved splits by legId for the mobile athlete flow", () => {
  const legs = [
    {
      id: "56hk6B71",
      name: "Start Finish",
      type: "RUN",
      order: 0,
      distanceKm: 3,
    },
  ];
  const splits = [
    {
      id: "5Z6FmglY",
      name: "Start",
      importedName: "Start",
      legId: "56hk6B71",
      order: 0,
      distanceKm: 0,
      timingPointId: "5cdao43D",
      passage: 1,
      visible: true,
    },
    {
      id: "6CsFQEXk",
      name: "Finish",
      importedName: "Finish",
      legId: "56hk6B71",
      order: 1,
      distanceKm: 3,
      timingPointId: "5cdao43D",
      passage: 2,
      visible: true,
    },
  ];
  const response = {
    success: true,
    eventId: "f2ffb40b-1b50-4f41-b769-b5e9895e3334",
    athlete: {
      participantUuid: "3tKVFkkV",
      providerContestUuid: "5JUm5wtI",
      status: "REGISTERED",
      splits: [],
    },
    contestContext: {
      contest: {
        id: "5JUm5wtI",
        contestUuid: "5JUm5wtI",
        name: "Test 1",
      },
      legs,
      splits,
    },
    timingConfiguration: {
      raceFlowByContest: {
        "5JUm5wtI": { legs, splits },
      },
    },
  } as unknown as AthleteModalResponse;

  const flow = buildCanonicalRaceFlow(response);

  expect(flow?.sections).toHaveLength(1);
  expect(flow?.sections[0]).toMatchObject({
    shortLabel: "RN",
    title: "Run",
    status: "not_started",
  });
  expect(flow?.sections[0].rows.map((row) => row.name)).toEqual([
    "Start",
    "Finish",
  ]);
  expect(flow?.sections[0].rows.map((row) => row.cumulativeDistanceKm)).toEqual([
    0,
    3,
  ]);
});

test("joins canonical Feibot splitId results to the saved Race Flow", () => {
  const legs = [{ id: "run", name: "Start Finish", type: "RUN", order: 0, distanceKm: 3 }];
  const splits = [
    { id: "provider-start", name: "Start", legId: "run", order: 0, distanceKm: 0 },
    { id: "provider-finish", name: "Finish", legId: "run", order: 1, distanceKm: 3 },
  ];
  const response = {
    success: true,
    eventId: "event-1",
    athlete: { participantUuid: "athlete-1", providerContestUuid: "contest-1", status: "FINISHED", splits: [] },
    participantLive: {
      splits: [
        { splitId: "provider-start", name: "Start", cumulativeTime: "00:00:00.000", officialTimeMs: 0, status: "PROVISIONAL", source: "FEIBOT_PROCESSED" },
        { splitId: "provider-finish", name: "Finish", cumulativeTime: "00:26:30.000", officialTimeMs: 1_590_000, sectionTimeMs: 1_590_000, status: "PROVISIONAL", source: "FEIBOT_PROCESSED" },
      ],
    },
    contestContext: { contest: { id: "contest-1", contestUuid: "contest-1", name: "Test" }, legs, splits },
    timingConfiguration: { raceFlowByContest: { "contest-1": { legs, splits } } },
  } as unknown as AthleteModalResponse;

  const flow = buildCanonicalRaceFlow(response);

  expect(flow?.sections[0]).toMatchObject({ shortLabel: "RN", status: "completed", durationSeconds: 1590 });
  expect(flow?.sections[0].rows.map((row) => row.status)).toEqual(["valid", "valid"]);
  expect(flow?.sections[0].rows[1]).toMatchObject({ overallElapsedSeconds: 1590, splitDurationSeconds: 1590 });
});

test("merges split rank from a duplicate canonical timing projection", () => {
  const legs = [{ id: "bike", name: "Bike", type: "BIKE", order: 0, distanceKm: 10 }];
  const splits = [
    { id: "bike-start", name: "Bike Start", legId: "bike", order: 0, distanceKm: 0 },
    { id: "bike-finish", name: "Bike Finish", legId: "bike", order: 1, distanceKm: 10 },
  ];
  const response = {
    success: true,
    eventId: "event-1",
    athlete: {
      participantUuid: "athlete-1",
      providerContestUuid: "contest-1",
      status: "FINISHED",
      splits: [
        { splitId: "bike-start", officialTimeMs: 0, rankAtSplit: 2, status: "PROVISIONAL", source: "FEIBOT_PROCESSED" },
        { splitId: "bike-finish", officialTimeMs: 600_000, sectionTimeMs: 600_000, rankAtSplit: 1, status: "PROVISIONAL", source: "FEIBOT_PROCESSED" },
      ],
    },
    participantLive: {
      resolvedRaceState: {
        splits: [
          { splitId: "bike-start", officialTimeMs: 0, status: "PROVISIONAL", source: "FEIBOT_PROCESSED" },
          { splitId: "bike-finish", officialTimeMs: 600_000, sectionTimeMs: 600_000, status: "PROVISIONAL", source: "FEIBOT_PROCESSED" },
        ],
      },
    },
    contestContext: { contest: { id: "contest-1", contestUuid: "contest-1", name: "Test" }, legs, splits },
    timingConfiguration: { raceFlowByContest: { "contest-1": { legs, splits } } },
  } as unknown as AthleteModalResponse;

  const flow = buildCanonicalRaceFlow(response);
  expect(flow?.sections[0].rows.map((row) => row.rank)).toEqual(["#2", "#1"]);
});

test("uses accepted START evidence instead of the configured gun schedule for time of day", () => {
  const legs = [{ id: "run", name: "Start Finish", type: "RUN", order: 0, distanceKm: 3 }];
  const splits = [
    { id: "provider-start", name: "Start", legId: "run", order: 0, distanceKm: 0 },
    { id: "provider-finish", name: "Finish", legId: "run", order: 1, distanceKm: 3 },
  ];
  const response = {
    success: true,
    eventId: "event-1",
    athlete: { participantUuid: "athlete-1", providerContestUuid: "contest-1", status: "IN_PROGRESS", splits: [] },
    participantLive: {
      eventTimezone: "Etc/UTC",
      resolvedRaceState: { athleteStartTime: "2026-08-28T09:22:15.000Z" },
      splits: [
        { splitId: "provider-start", cumulativeTime: "00:00:00", officialTimeMs: 0, status: "PROVISIONAL", source: "FEIBOT_PROCESSED" },
        { splitId: "provider-finish", cumulativeTime: "00:26:30", officialTimeMs: 1_590_000, status: "PROVISIONAL", source: "FEIBOT_PROCESSED" },
      ],
    },
    contestContext: { contest: { id: "contest-1", contestUuid: "contest-1", name: "Test" }, legs, splits },
    timingConfiguration: {
      start: { timingMode: "GUN", gunStartAt: "2026-08-28T09:20:00.000Z" },
      raceFlowByContest: { "contest-1": { legs, splits } },
    },
  } as unknown as AthleteModalResponse;

  const flow = buildCanonicalRaceFlow(response);

  expect(flow?.sections[0].rows.map((row) => row.timeOfDay)).toEqual(["09:22:15", null]);
});

test("uses backend canonical T1/T2 sections and leaves incomplete transitions pending", () => {
  const legs = [
    { key: "swim", legType: "SWIM", order: 1, startSplitKey: "swim_start", finishSplitKey: "swim_finish" },
    { key: "bike", legType: "BIKE", order: 3, startSplitKey: "bike_start", finishSplitKey: "bike_finish" },
    { key: "run", legType: "RUN", order: 5, startSplitKey: "run_start", finishSplitKey: "run_finish" },
  ];
  const splits = [
    { key: "swim_start", displayName: "Start", legType: "SWIM", order: 1 },
    { key: "swim_finish", displayName: "Swim Finish", legType: "SWIM", order: 2 },
    { key: "bike_start", displayName: "Bike Start", legType: "BIKE", order: 3 },
    { key: "bike_finish", displayName: "Bike Finish", legType: "BIKE", order: 4 },
    { key: "run_start", displayName: "Run Start", legType: "RUN", order: 5 },
    { key: "run_finish", displayName: "Run Finish", legType: "RUN", order: 6 },
  ];
  const transitions = [
    { key: "provider-transition-1", transitionType: "T1", order: 2, startSplitKey: "swim_finish", finishSplitKey: "bike_start" },
    { key: "T2", order: 4, startSplitKey: "bike_finish", finishSplitKey: "run_start" },
  ];
  const sections = [
    { key: "SWIM", type: "SWIM", order: 1, status: "completed", durationSeconds: 1800 },
    { key: "T1", type: "T1", order: 2, status: "completed", durationSeconds: 125, transitionSource: "calculated" },
    { key: "BIKE", type: "BIKE", order: 3, status: "in_progress", durationSeconds: 600 },
    { key: "T2", type: "T2", order: 4, status: "not_started", durationSeconds: null, transitionSource: "pending" },
    { key: "RUN", type: "RUN", order: 5, status: "not_started", durationSeconds: null },
  ];
  const response = {
    success: true,
    eventId: "event-1",
    athlete: {
      participantUuid: "athlete-1",
      providerContestUuid: "contest-1",
      status: "STARTED",
      summary: { t1Seconds: 9999, t2Seconds: 9999 },
      splits: [
        { splitKey: "swim_start", elapsedSeconds: 0, status: "VALID", readAt: "2026-08-07T12:30:00Z" },
        { splitKey: "swim_finish", elapsedSeconds: 1800, status: "VALID", readAt: "2026-08-07T13:00:00Z" },
        { splitKey: "bike_start", elapsedSeconds: 1920, status: "VALID", readAt: "2026-08-07T13:02:00Z" },
      ],
    },
    contestContext: {
      contest: { providerContestUuid: "contest-1", splits, legs, transitions, sections },
      splits, legs, transitions, sections,
    },
  } as unknown as AthleteModalResponse;

  const flow = buildCanonicalRaceFlow(response);
  expect(flow?.sections.map((section) => section.shortLabel)).toEqual(["SW", "T1", "BK", "T2", "RN"]);
  expect(flow?.sections.find((section) => section.shortLabel === "T1")?.durationSeconds).toBe(125);
  expect(flow?.sections.find((section) => section.shortLabel === "T2")).toMatchObject({
    status: "not_started",
    durationSeconds: null,
  });
});

test("repairs a collapsed Feibot triathlon so Swim Finish does not complete every leg", () => {
  const collapsedLegs = [{ id: "collapsed", name: "SWIM", type: "RUN", order: 0, distanceKm: 51.5 }];
  const collapsedSplits = [
    { id: "swim-start", name: "SWIM START", legId: "collapsed", order: 0, distanceKm: 0 },
    { id: "swim-finish", name: "SWIM FINISH", legId: "collapsed", order: 1, distanceKm: 1.5 },
    { id: "bike-start", name: "BIKE START", legId: "collapsed", order: 2, distanceKm: 1.6 },
    { id: "bike-finish", name: "BIKE FINISH", legId: "collapsed", order: 3, distanceKm: 41.5 },
    { id: "run-start", name: "RUN START", legId: "collapsed", order: 4, distanceKm: 41.6 },
    { id: "run-finish", name: "RUN FINISH", legId: "collapsed", order: 5, distanceKm: 51.5 },
  ];
  const response = {
    success: true,
    eventId: "event-1",
    athlete: {
      participantUuid: "athlete-1",
      providerContestUuid: "contest-1",
      status: "STARTED",
      splits: [
        { splitId: "swim-start", name: "SWIM START", officialTimeMs: 0, status: "PROVISIONAL", source: "FEIBOT_PROCESSED" },
        { splitId: "swim-finish", name: "SWIM FINISH", officialTimeMs: 642_000, status: "PROVISIONAL", source: "FEIBOT_PROCESSED" },
      ],
    },
    ticketDefinition: {
      ticketCategory: "TRIATHLON",
      courseMaps: { swimDistance: 1.5, bikeDistance: 40, runDistance: 10 },
    },
    contestContext: {
      contest: { providerContestUuid: "contest-1", raceType: "TRIATHLON" },
      legs: collapsedLegs,
      splits: collapsedSplits,
    },
    timingConfiguration: {
      raceFlowByContest: {
        "contest-1": { legs: collapsedLegs, splits: collapsedSplits },
      },
    },
  } as unknown as AthleteModalResponse;

  const flow = buildCanonicalRaceFlow(response);
  expect(flow?.sections.map((section) => [section.shortLabel, section.status])).toEqual([
    ["SW", "completed"],
    ["T1", "in_progress"],
    ["BK", "not_started"],
    ["T2", "not_started"],
    ["RN", "not_started"],
  ]);
});

test("keeps ten Feibot checkpoints and moves from Bike Finish into T2", () => {
  const names = ["SWIM START", "SWIM FINISH", "BIKE START", "BIKE 10 KM", "BIKE 20 KM", "BIKE FINISH", "RUN START", "RUN 5K", "RUN 10K", "FINISH"];
  const legs = Array.from({ length: 5 }, (_, index) => ({ id: `leg-${index}`, name: "RUN", type: "RUN", order: index }));
  const splits = names.map((name, index) => ({ id: `split-${index}`, name, importedName: name, legId: "leg-0", order: index, distanceKm: index * 5 }));
  const response = {
    success: true,
    eventId: "event-1",
    athlete: {
      providerContestUuid: "contest-1",
      status: "STARTED",
      splits: splits.slice(0, 6).map((split, index) => ({ splitId: split.id, name: split.name, officialTimeMs: index * 600_000, status: "PROVISIONAL", source: "FEIBOT_PROCESSED" })),
    },
    contestContext: { contest: { providerContestUuid: "contest-1" }, legs, splits },
    timingConfiguration: { raceFlowByContest: { "contest-1": { legs, splits } } },
  } as unknown as AthleteModalResponse;
  const flow = buildCanonicalRaceFlow(response);
  expect(flow?.sections.map((section) => [section.shortLabel, section.status])).toEqual([
    ["SW", "completed"], ["T1", "completed"], ["BK", "completed"], ["T2", "in_progress"], ["RN", "not_started"],
  ]);
  expect(flow?.sections.find((section) => section.shortLabel === "BK")?.rows).toHaveLength(4);
  expect(flow?.sections.find((section) => section.shortLabel === "RN")?.rows).toHaveLength(4);
  expect(flow?.sections.find((section) => section.shortLabel === "T2")?.durationSeconds).toBeNull();
  expect(flow?.sections.find((section) => section.shortLabel === "T1")?.durationSeconds).toBe(600);
  expect(flow?.sections.find((section) => section.shortLabel === "BK")?.durationSeconds).toBe(1800);
});

test("derives missing triathlon transitions and times from accepted Feibot mats", () => {
  const names = ["SWIM START", "SWIM FINISH", "BIKE START", "BIKE FINISH", "RUN START", "FINISH"];
  const types = ["SWIM", "SWIM", "BIKE", "BIKE", "RUN", "RUN"];
  const splits = names.map((name, index) => ({
    id: `split-${index}`, name, legType: types[index], order: index,
    distanceKm: [0, 1.5, 1.5, 41.5, 41.5, 51.5][index],
  }));
  const legs = ["SWIM", "BIKE", "RUN"].map((type, index) => ({
    id: type.toLowerCase(), name: type, type, order: index,
  }));
  const response = {
    success: true, eventId: "event-1",
    athlete: {
      providerContestUuid: "contest-1", status: "FINISHED",
      splits: splits.map((split, index) => ({
        splitId: split.id, officialTimeMs: [0, 1800000, 1920000, 5520000, 5700000, 9300000][index],
        status: "PROVISIONAL", source: "FEIBOT_PROCESSED",
      })),
    },
    contestContext: { contest: { providerContestUuid: "contest-1" }, legs, splits },
    timingConfiguration: { raceFlowByContest: { "contest-1": { legs, splits } } },
  } as unknown as AthleteModalResponse;
  const flow = buildCanonicalRaceFlow(response);
  expect(flow?.sections.map((section) => [section.shortLabel, section.durationSeconds])).toEqual([
    ["SW", 1800], ["T1", 120], ["BK", 3600], ["T2", 180], ["RN", 3600],
  ]);
});
