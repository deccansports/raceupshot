import assert from "node:assert/strict";
import test from "node:test";

import { mapAthleteDetail } from "./mappers";

test("Race Upshot provisional canonical splits render identity, times and course movement", () => {
  const detail = mapAthleteDetail({
    success: true,
    eventId: "event-1",
    visibility: "PUBLIC",
    athlete: {
      id: "participant-1",
      participantUid: "participant-1",
      bib: "1001",
      displayName: "Shashank Agrawal",
      name: "Shashank Agrawal",
      ageGroupName: "Under 12",
      contestId: "contest-1",
      contestName: "Test 1",
      raceStatus: "STARTED",
      status: "STARTED",
      latestTimingPoint: "Start",
      splits: [{
        splitId: "start",
        name: "Start",
        cumulativeTime: "00:00:00.000",
        officialTimeMs: 0,
        chipTimeMs: 0,
        readerTimestamp: "2026-08-28T09:06:24.852Z",
        status: "PROVISIONAL",
        source: "FEIBOT_PROCESSED",
      }],
    },
    timingConfiguration: {
      legs: [{ id: "run", name: "Run", type: "RUN", order: 0, distanceKm: 3 }],
      splits: [
        { id: "start", name: "Start", legId: "run", order: 0, distanceKm: 0, visible: true },
        { id: "finish", name: "Finish", legId: "run", order: 1, distanceKm: 3, visible: true },
      ],
    },
  } as never);

  assert.equal(detail.header.name, "Shashank Agrawal");
  assert.equal(detail.header.category, "Under 12");
  assert.equal(detail.timeline[0]?.name, "Start");
  assert.equal(detail.timeline[0]?.state, "completed");
  assert.equal(detail.timeline[1]?.name, "Finish");
  assert.equal(detail.timeline[1]?.state, "current");
  assert.equal(detail.timeline.length, 2, "only the single next checkpoint is revealed");
  assert.ok(detail.track, "an accepted canonical Start should seed map interpolation");
  assert.equal(detail.track?.seed.anchorKm, 0);
  assert.equal(detail.track?.seed.nextKm, 3);
  assert.equal(detail.track?.totalKm, 3);
  assert.equal(detail.nextSplit?.checkpoint, "Finish");
  assert.ok(detail.nextSplit?.etaElapsed, "a Start-only runner should receive a Finish ETA");
  assert.ok(detail.prediction?.finishTimeLabel, "a Start-only runner should receive an estimated finish");
});

test("positive live elapsed time keeps the mobile race clock running while the START projection catches up", () => {
  const detail = mapAthleteDetail({
    success: true,
    eventId: "event-1",
    visibility: "PUBLIC",
    athlete: {
      id: "participant-1",
      bib: "1001",
      displayName: "Shashank Agrawal",
      contestId: "contest-1",
      contestName: "Test 1",
      status: "STARTED",
      elapsedTime: "00:26:30",
    },
    participantLive: {
      resolvedRaceState: {
        status: "WAITING_START",
        hasAcceptedStart: false,
      },
    },
    timingConfiguration: {
      legs: [{ id: "run", name: "Run", type: "RUN", order: 0, distanceKm: 3 }],
      splits: [
        { id: "start", name: "Start", legId: "run", order: 0, distanceKm: 0, visible: true },
        { id: "finish", name: "Finish", legId: "run", order: 1, distanceKm: 3, visible: true },
      ],
    },
  } as never);

  assert.equal(detail.header.status, "live");
  assert.equal(detail.startTiming.showRaceClock, true);
  assert.equal(detail.liveStats.find((row) => row.label === "Elapsed")?.value, "00:26:30");
});

test("accepted CHIP START anchors the displayed live clock to the Feibot start passage", () => {
  const detail = mapAthleteDetail({
    success: true,
    eventId: "event-1",
    visibility: "PUBLIC",
    athlete: {
      id: "participant-1",
      bib: "102",
      displayName: "Agastya Jha",
      contestId: "contest-1",
      contestName: "Test 1",
    },
    participantLive: {
      resolvedRaceState: {
        officialTimingMode: "CHIP",
        status: "ON_COURSE",
        hasAcceptedStart: true,
        gunStartAt: "2026-08-28T11:00:00+05:30",
        chipStartAt: "2026-08-28T11:04:30+05:30",
      },
    },
  } as never);

  assert.equal(
    detail.raceStartedAt,
    Date.parse("2026-08-28T11:04:30+05:30"),
  );
});

test("configured start mode overrides a stale provider timing mode", () => {
  const chipStartAt = "2026-08-28T11:04:30+05:30";
  const detail = mapAthleteDetail({
    success: true,
    eventId: "event-1",
    visibility: "PUBLIC",
    athlete: {
      id: "participant-1",
      bib: "102",
      displayName: "Configured Chip Runner",
      status: "STARTED",
    },
    participantLive: {
      resolvedRaceState: {
        officialTimingMode: "GUN",
        status: "ON_COURSE",
        hasAcceptedStart: true,
        gunStartAt: "2026-08-28T11:00:00+05:30",
        chipStartAt,
      },
    },
    timingConfiguration: {
      start: { timingMode: "CHIP" },
    },
  } as never);

  assert.equal(detail.startTiming.officialTimingMode, "CHIP");
  assert.equal(detail.raceStartedAt, Date.parse(chipStartAt));
});

test("GUN athlete elapsed clock is anchored to the configured contest gun", () => {
  const gunStartAt = "2026-08-28T11:00:00+05:30";
  const detail = mapAthleteDetail({
    success: true,
    eventId: "event-1",
    visibility: "PUBLIC",
    athlete: {
      id: "participant-1",
      bib: "103",
      displayName: "Gun Runner",
      contestId: "contest-1",
      contestName: "Test 1",
      status: "STARTED",
      elapsedTime: "00:10:00",
    },
    participantLive: {
      resolvedRaceState: {
        status: "ON_COURSE",
        hasAcceptedStart: true,
        // A later reader passage must not replace the GUN clock baseline.
        acceptedStartAt: "2026-08-28T11:04:30+05:30",
      },
    },
    timingConfiguration: {
      start: {
        timingMode: "GUN",
        gunStartAt,
      },
    },
  } as never);

  assert.equal(detail.raceStartedAt, Date.parse(gunStartAt));
});

test("reconstructs a missing START timestamp from the latest official split", () => {
  const splitReadAt = "2026-10-11T07:30:00.000Z";
  const detail = mapAthleteDetail({
    success: true,
    eventId: "event-1",
    visibility: "PUBLIC",
    athlete: {
      id: "participant-1002",
      bib: "1002",
      displayName: "Reopen Runner",
      status: "STARTED",
      elapsedTime: "01:30:00",
      splits: [
        {
          splitId: "bike-finish",
          name: "Bike Finish",
          officialTimeMs: 5_400_000,
          readerTimestamp: splitReadAt,
          status: "PROVISIONAL",
          source: "FEIBOT_PROCESSED",
        },
      ],
    },
    timingConfiguration: {
      start: { timingMode: "GUN" },
    },
  } as never);

  assert.equal(
    detail.raceStartedAt,
    Date.parse(splitReadAt) - 5_400_000,
  );
});

test("finished results expose configured distance and average speed", () => {
  const detail = mapAthleteDetail({
    success: true,
    eventId: "event-1",
    visibility: "PUBLIC",
    athlete: {
      id: "participant-1",
      bib: "10",
      displayName: "Runner",
      contestName: "10K",
      raceStatus: "FINISHED",
      status: "FINISHED",
    },
    result: {
      status: "FINISHED",
      chipTime: "01:00:00",
      officialTime: "01:00:00",
      splits: [{ label: "Finish", time: "01:00:00", distanceKm: 10 }],
      provisional: false,
    },
    courseOverview: { totalKm: 10, breakdown: [] },
  } as never);

  assert.equal(detail.result?.distanceKm, 10);
  assert.equal(detail.result?.averageSpeedKmh, 10);
});

test("finished result start boundaries never turn transition time into sport pace", () => {
  const detail = mapAthleteDetail({
    success: true,
    eventId: "event-1",
    visibility: "PUBLIC",
    athlete: {
      id: "participant-1",
      bib: "1005",
      displayName: "Transition Athlete",
      contestName: "Triathlon",
      raceStatus: "FINISHED",
      status: "FINISHED",
      splits: [
        { splitId: "swim-finish", name: "Swim Finish", cumulativeTime: "00:28:14", officialTimeMs: 1_694_000, distanceKm: 1.5, status: "PROVISIONAL" },
        { splitId: "bike-start", name: "Bike Start", cumulativeTime: "00:41:58", officialTimeMs: 2_518_000, distanceKm: 1.6, paceSpeed: "0.4 km/h", status: "PROVISIONAL" },
        { splitId: "bike-finish", name: "Bike Finish", cumulativeTime: "01:35:05", officialTimeMs: 5_705_000, distanceKm: 41.5, status: "PROVISIONAL" },
        { splitId: "run-start", name: "Run Start", cumulativeTime: "01:47:02", officialTimeMs: 6_422_000, distanceKm: 41.6, paceSpeed: "119:30 /km", status: "PROVISIONAL" },
        { splitId: "race-finish", name: "Race Finish", cumulativeTime: "02:57:24", officialTimeMs: 10_644_000, distanceKm: 51.5, status: "PROVISIONAL" },
      ],
    },
    result: {
      status: "FINISHED",
      chipTime: "02:57:24",
      officialTime: "02:57:24",
      splits: [
        { label: "Swim Finish", time: "00:28:14", distanceKm: 1.5 },
        { label: "Bike Start", time: "00:41:58", distanceKm: 1.6, paceSpeed: "0.4 km/h" },
        { label: "Bike Finish", time: "01:35:05", distanceKm: 41.5 },
        { label: "Run Start", time: "01:47:02", distanceKm: 41.6, paceSpeed: "119:30 /km" },
        { label: "Race Finish", time: "02:57:24", distanceKm: 51.5 },
      ],
    },
    timingConfiguration: {
      legs: [
        { id: "swim", name: "Swim", type: "SWIM", order: 1, distanceKm: 1.5 },
        { id: "bike", name: "Bike", type: "BIKE", order: 2, distanceKm: 40 },
        { id: "run", name: "Run", type: "RUN", order: 3, distanceKm: 10 },
      ],
      splits: [
        { id: "swim-finish", name: "Swim Finish", legId: "swim", order: 1, distanceKm: 1.5 },
        { id: "bike-start", name: "Bike Start", legId: "bike", order: 2, distanceKm: 1.6 },
        { id: "bike-finish", name: "Bike Finish", legId: "bike", order: 3, distanceKm: 41.5 },
        { id: "run-start", name: "Run Start", legId: "run", order: 4, distanceKm: 41.6 },
        { id: "race-finish", name: "Race Finish", legId: "run", order: 5, distanceKm: 51.5, isRaceFinish: true },
      ],
    },
  } as never);

  assert.equal(detail.result?.splits.find((split) => split.label === "Bike Start")?.paceSpeed, undefined);
  assert.equal(detail.result?.splits.find((split) => split.label === "Run Start")?.paceSpeed, undefined);
  assert.equal(detail.result?.splits.find((split) => split.label === "Bike Start")?.value, "00:41:58");
  assert.equal(detail.result?.splits.find((split) => split.label === "Run Start")?.value, "01:47:02");
});
