import assert from 'node:assert/strict';
import test from 'node:test';

import { calculateCanonicalDurations, mergeProcessedParticipantLiveSnapshot, recalculateAthleteSnapshot, selectCanonicalTimingRead } from './snapshot.ts';
import { buildCanonicalLeaderboards } from './leaderboards.ts';

test('locked official finish is not overwritten by a later lower-priority read', () => {
  const split: any = { key: 'run_finish', readSelectionRule: 'last', passNumber: null };
  const official: any = { readId: 'official', status: 'official', source: 'final', elapsedSeconds: 10800, timestamp: '2026-08-08T12:40:00.000Z', occurredAt: '2026-08-08T12:40:00.000Z' };
  const laterProvisional: any = { readId: 'provisional', status: 'valid', source: 'feibot', elapsedSeconds: 10900, timestamp: '2026-08-08T12:41:40.000Z', occurredAt: '2026-08-08T12:41:40.000Z' };
  assert.equal(selectCanonicalTimingRead(official, laterProvisional, split)?.readId, 'official');
});

test('triathlon can finish only after the configured Run Finish has accepted chronological evidence', () => {
  const contest: any = {
    raceType: 'triathlon', totalDistanceKm: 52, timezone: 'Asia/Kolkata',
    startConfiguration: { mode: 'GUN', gunStartTime: '2026-08-08T09:40:00.000Z' },
    splits: [
      { key: 'swim_start', displayName: 'Start', legType: 'swim', order: 1, cumulativeDistanceKm: 0, distanceInLegKm: 0, isStart: true },
      { key: 'swim_finish', displayName: 'Swim Finish', legType: 'swim', order: 2, cumulativeDistanceKm: 2, distanceInLegKm: 2 },
      { key: 'bike_start', displayName: 'Bike Start', legType: 'bike', order: 3, cumulativeDistanceKm: 2, distanceInLegKm: 0 },
      { key: 'bike_finish', displayName: 'Bike Finish', legType: 'bike', order: 4, cumulativeDistanceKm: 42, distanceInLegKm: 40 },
      { key: 'run_start', displayName: 'Run Start', legType: 'run', order: 5, cumulativeDistanceKm: 42, distanceInLegKm: 0 },
      { key: 'run_finish', displayName: 'Run Finish', legType: 'run', order: 6, cumulativeDistanceKm: 52, distanceInLegKm: 10, isFinish: true },
    ],
    legs: [{ type: 'swim', distanceKm: 2 }, { type: 'bike', distanceKm: 40 }, { type: 'run', distanceKm: 10 }],
    sections: [],
  };
  const read = (key: string, elapsedSeconds: number, status = 'official') => ({
    readId: key, status, elapsedSeconds,
    timestamp: new Date(Date.parse('2026-08-08T09:40:00.000Z') + elapsedSeconds * 1000).toISOString(),
    occurredAt: new Date(Date.parse('2026-08-08T09:40:00.000Z') + elapsedSeconds * 1000).toISOString(),
  });
  const makeSnapshot = (reads: Record<string, any>) => ({
    identity: { bib: '1001' }, updatedAt: '2026-08-08T12:00:00.000Z', raceState: { status: 'not_started' },
    reads: { swim_start: null, swim_finish: null, bike_start: null, bike_finish: null, run_start: null, run_finish: null, ...reads },
    splits: [], calculated: {}, splitRankings: {}, sections: [], location: null,
  }) as any;

  const chronological: Array<[string, number]> = [
    ['swim_start', 366],
    ['swim_finish', 3600],
    ['bike_start', 3720],
    ['bike_finish', 8400],
    ['run_start', 8520],
  ];
  const accepted: Record<string, any> = {};

  assert.notEqual(recalculateAthleteSnapshot(makeSnapshot({}), contest).raceState.status, 'finished');
  for (const [key, elapsedSeconds] of chronological) {
    accepted[key] = read(key, elapsedSeconds);
    const state = recalculateAthleteSnapshot(makeSnapshot(accepted), contest, '2026-08-08T12:10:00.000Z');
    assert.notEqual(state.raceState.status, 'finished', `${key} must not finish the race`);
    assert.notEqual(state.raceState.resolved?.status, 'FINISHED', `${key} must not resolve FINISHED`);
  }

  const invalidFinish = recalculateAthleteSnapshot(
    makeSnapshot({ ...accepted, run_finish: read('run_finish_invalid', 10800, 'invalid') }),
    contest,
    '2026-08-08T12:45:00.000Z',
  );
  assert.notEqual(invalidFinish.raceState.status, 'finished');
  assert.equal(invalidFinish.calculated.overallSeconds, null);

  const reversedIntermediate = recalculateAthleteSnapshot(makeSnapshot({
    swim_start: read('start', 366),
    swim_finish: read('swim_finish', 3600),
    bike_start: read('bike_start_reversed', 0),
    bike_finish: read('bike_finish', 3900),
    run_start: read('run_start', 4000),
    run_finish: read('run_finish', 4100),
  }), contest, '2026-08-08T12:45:00.000Z');
  assert.notEqual(reversedIntermediate.raceState.status, 'finished');
  assert.equal(reversedIntermediate.reads.bike_start?.status, 'invalid');
  assert.equal(reversedIntermediate.reads.run_finish, null);

  const finished = recalculateAthleteSnapshot(
    makeSnapshot({ ...accepted, run_finish: read('run_finish', 10800) }),
    contest,
    '2026-08-08T12:45:00.000Z',
  );
  assert.equal(finished.raceState.status, 'finished');
  assert.equal(finished.raceState.resolved?.status, 'FINISHED');
  assert.equal(finished.calculated.overallSeconds, 10800);
});

test('accepted processed final split self-heals the active versioned athlete and freezes the final race clock', () => {
  const gunStart = '2026-08-08T14:40:00.000Z'; // 20:10:00 Asia/Kolkata
  const definitions = [
    ['swim_start', '4uscdYgh', 'Start', 'swim', 1, 0, 0],
    ['swim_finish', '4RSDJfEL', 'Swim Finish', 'swim', 2, 2, 2],
    ['bike_start', '3BoGq8U9', 'Bike Start', 'bike', 3, 0, 2],
    ['bike_finish', '3c3jrd9F', 'Bike Finish', 'bike', 4, 40, 42],
    ['run_start', '4R4DBz6h', 'Run Start', 'run', 5, 0, 42],
    ['run_finish', '4DBMkLxV', 'Run Finish', 'run', 6, 10, 52],
  ] as const;
  const contest: any = {
    providerContestUuid: '1TuQz5ok', raceType: 'triathlon', totalDistanceKm: 52,
    timezone: 'Asia/Kolkata', startConfiguration: { mode: 'GUN', gunStartTime: gunStart },
    splits: definitions.map(([key, providerSplitId, displayName, legType, order, distanceInLegKm, cumulativeDistanceKm]) => ({
      key, providerSplitId, providerTimingPointId: '3SnLaO9I', displayName, legType, order,
      distanceInLegKm, cumulativeDistanceKm, readSelectionRule: 'last', passNumber: order,
      isStart: key === 'swim_start', isRaceStart: key === 'swim_start',
      isFinish: key === 'run_finish', isRaceFinish: key === 'run_finish',
    })),
    legs: [{ type: 'swim', distanceKm: 2 }, { type: 'bike', distanceKm: 40 }, { type: 'run', distanceKm: 10 }],
    sections: [], cutoffs: {},
  };
  const before: any = {
    schemaVersion: 1, eventId: 'evt', buildVersion: 'build-1', updatedAt: '2026-08-08T15:34:44.000Z',
    contestUuid: '1TuQz5ok', courseVersion: 1, timingVersion: 5, leaderboardVersion: 2,
    identity: { participantUuid: 'race:evt:contest:1003', providerParticipantUuid: 'provider-1003', bib: '1003', chipCode: 'MC69898' },
    bergmanIdentity: {}, raceState: { status: 'running' },
    startTiming: { officialStartTime: gunStart, chipStartDetectionTime: '2026-08-08T14:42:30.000Z', startTimeSource: 'GUN', startTimeLocked: true, startStatus: 'ON_COURSE' },
    reads: Object.fromEntries(definitions.map(([key]) => [key, null])),
    calculated: {}, sections: [], splits: [], splitRankings: {}, overallRanking: {}, location: null,
    versions: { course: 1, participant: 1, timing: 5, profile: 1, leaderboard: 2 },
  };
  const seconds = [150, 976, 1499, 2472, 2684, 3327];
  const processed = {
    updatedAt: '2026-08-08T15:35:28.000Z',
    splits: definitions.map(([key, splitUuid], index) => ({
      splitKey: key, splitUuid, accepted: true, progressStatus: 'COMPLETED',
      // Feibot commonly returns processed read timestamps as Unix seconds.
      // Keep the first row numeric to guard the live participant merge path.
      readAt: index === 0
        ? (Date.parse(gunStart) + seconds[index] * 1000) / 1000
        : new Date(Date.parse(gunStart) + seconds[index] * 1000).toISOString(),
      overallElapsedSeconds: seconds[index], legElapsedSeconds: index === 0 || index === 2 || index === 4 ? 0 : undefined,
      passNumber: index + 1,
    })),
  };
  const after = mergeProcessedParticipantLiveSnapshot(before, contest, processed, processed.updatedAt);
  const resolved = after.raceState.resolved;
  assert.equal(after.reads.run_finish?.providerSplitId, '4DBMkLxV');
  assert.equal(after.splits.find((split: any) => split.splitKey === 'run_finish')?.progressStatus, 'COMPLETED');
  assert.equal(resolved?.status, 'FINISHED');
  assert.equal(resolved?.finalSplitAccepted, true);
  assert.equal(resolved?.finishAt, '2026-08-08T15:35:27.000Z');
  assert.equal(resolved?.officialFinishAt, '2026-08-08T15:35:27.000Z');
  assert.equal(resolved?.finishTimeOfDay, '21:05:27');
  assert.equal(resolved?.finalElapsedMs, 3_327_000);
  assert.equal(resolved?.lastCompletedSplit?.splitKey, 'run_finish');
  assert.equal(resolved?.nextExpectedSplit, null);
  assert.deepEqual(
    resolved?.splits.map((split: any) => split.overallElapsedSeconds),
    seconds,
  );
  assert.deepEqual(
    resolved?.splits.filter((split: any) => split.splitKey.endsWith('_start')).map((split: any) => split.legElapsedSeconds),
    [0, 0, 0],
  );
  assert.equal(after.calculated.swimSeconds, 826);
  assert.equal(after.calculated.t1Seconds, 523);
  assert.equal(after.calculated.bikeSeconds, 973);
  assert.equal(after.calculated.t2Seconds, 212);
  assert.equal(after.calculated.runSeconds, 643);
  assert.equal(after.calculated.overallSeconds, 3327);
  const idempotent = mergeProcessedParticipantLiveSnapshot(after, contest, processed, processed.updatedAt);
  assert.equal(idempotent.timingVersion, after.timingVersion);
});

test('quarantines processed evidence when timing-point/pass resolves to multiple splits', () => {
  const contest: any = {
    providerEventUuid: '6QTff6CR',
    providerContestUuid: '6UWIfyI9',
    raceType: 'triathlon',
    timezone: 'Asia/Kolkata',
    splits: [
      { key: 'swim_finish', providerSplitId: '73VTBWS4', providerTimingPointId: '5fD3OAat', passNumber: 2, displayName: 'Swim Finish', order: 2 },
      { key: 'run_finish', providerSplitId: 'dqnjps7i', providerTimingPointId: '5fD3OAat', passNumber: 2, displayName: 'Run Finish', order: 8 },
    ],
  };
  const before: any = {
    eventId: '4cEm8JPYbpupoFRMDLc1',
    buildVersion: 'last-good',
    updatedAt: '2026-08-18T06:22:57.076Z',
    reads: { swim_finish: null, run_finish: null },
  };
  const logged: any[] = [];
  const originalConsoleError = console.error;
  console.error = (...args: any[]) => { logged.push(args); };
  try {
    const after = mergeProcessedParticipantLiveSnapshot(before, contest, {
      updatedAt: '2026-08-18T07:00:00.000Z',
      splits: [{
        timingPointUuid: '5fD3OAat',
        passNumber: 2,
        accepted: true,
        readAt: '2026-08-18T06:59:59.000Z',
        overallElapsedSeconds: 3600,
      }],
    });
    assert.strictEqual(after, before);
    assert.equal(after.reads.swim_finish, null);
    assert.equal(after.reads.run_finish, null);
    assert.equal(logged[0]?.[0], '[CANONICAL TIMING AMBIGUOUS SPLIT]');
    assert.deepEqual(logged[0]?.[1]?.candidateSplits.map((split: any) => split.splitKey), ['swim_finish', 'run_finish']);
  } finally {
    console.error = originalConsoleError;
  }
});

test('leg summary uses accepted boundary intervals instead of cumulative checkpoint clocks', () => {
  const contest: any = {
    raceType: 'triathlon',
    splits: [
      { key: 'swim_start', order: 1, isStart: true },
      { key: 'swim_finish', order: 2 },
      { key: 'bike_start', order: 3 },
      { key: 'bike_finish', order: 4 },
      { key: 'run_start', order: 5 },
      { key: 'run_finish', order: 6, isFinish: true },
    ],
    legs: [
      { type: 'swim', order: 1, startSplitKey: 'swim_start', finishSplitKey: 'swim_finish', distanceKm: 2 },
      { type: 'bike', order: 3, startSplitKey: 'bike_start', finishSplitKey: 'bike_finish', distanceKm: 40 },
      { type: 'run', order: 5, startSplitKey: 'run_start', finishSplitKey: 'run_finish', distanceKm: 10 },
    ],
    transitions: [
      { key: 't1', type: 't1', startSplitKey: 'swim_finish', finishSplitKey: 'bike_start' },
      { key: 't2', type: 't2', startSplitKey: 'bike_finish', finishSplitKey: 'run_start' },
    ],
  };
  const official = (overallElapsedSeconds: number) => ({
    status: 'official',
    elapsedSeconds: overallElapsedSeconds,
    overallElapsedSeconds,
  });
  const metrics = calculateCanonicalDurations({
    swim_start: official(151),
    swim_finish: official(995),
    bike_start: official(1484),
    bike_finish: official(2459),
    run_start: official(2668),
    run_finish: official(3303),
  } as any, contest);
  assert.deepEqual(metrics, {
    swimSeconds: 844,
    t1Seconds: 489,
    bikeSeconds: 975,
    t2Seconds: 209,
    runSeconds: 635,
    overallSeconds: 3303,
    averageSwimPaceSecondsPer100m: 42.2,
    averageBikeSpeedKmh: 147.6923076923077,
    averageRunPaceSecondsPerKm: 63.5,
    averageRacePaceSecondsPerKm: 3303 / 52,
  });
});

test('GUN timing keeps one continuous race clock while deriving leg and transition durations', () => {
  const gunStart = '2026-08-08T11:50:00.000Z'; // 17:20:00 Asia/Kolkata
  const contest: any = {
    raceType: 'triathlon', totalDistanceKm: 52, timezone: 'Asia/Kolkata',
    startConfiguration: { mode: 'GUN', gunStartTime: gunStart },
    splits: [
      { key: 'swim_start', displayName: 'Start', legType: 'swim', order: 1, cumulativeDistanceKm: 0, distanceInLegKm: 0, isStart: true },
      { key: 'swim_finish', displayName: 'Swim Finish', legType: 'swim', order: 2, cumulativeDistanceKm: 2, distanceInLegKm: 2 },
      { key: 'bike_start', displayName: 'Bike Start', legType: 'bike', order: 3, cumulativeDistanceKm: 2, distanceInLegKm: 0 },
      { key: 'bike_finish', displayName: 'Bike Finish', legType: 'bike', order: 4, cumulativeDistanceKm: 42, distanceInLegKm: 40 },
      { key: 'run_start', displayName: 'Run Start', legType: 'run', order: 5, cumulativeDistanceKm: 42, distanceInLegKm: 0 },
      { key: 'run_finish', displayName: 'Run Finish', legType: 'run', order: 6, cumulativeDistanceKm: 52, distanceInLegKm: 10, isFinish: true },
    ],
    legs: [
      { key: 'swim', type: 'swim', startSplitKey: 'swim_start', finishSplitKey: 'swim_finish', distanceKm: 2 },
      { key: 'bike', type: 'bike', startSplitKey: 'bike_start', finishSplitKey: 'bike_finish', distanceKm: 40 },
      { key: 'run', type: 'run', startSplitKey: 'run_start', finishSplitKey: 'run_finish', distanceKm: 10 },
    ],
    sections: [
      { key: 'swim', sectionType: 'leg', legType: 'swim', startSplitKey: 'swim_start', finishSplitKey: 'swim_finish' },
      { key: 't1', sectionType: 'transition', transitionType: 't1', startSplitKey: 'swim_finish', finishSplitKey: 'bike_start' },
      { key: 'bike', sectionType: 'leg', legType: 'bike', startSplitKey: 'bike_start', finishSplitKey: 'bike_finish' },
      { key: 't2', sectionType: 'transition', transitionType: 't2', startSplitKey: 'bike_finish', finishSplitKey: 'run_start' },
      { key: 'run', sectionType: 'leg', legType: 'run', startSplitKey: 'run_start', finishSplitKey: 'run_finish' },
    ],
  };
  const at = (seconds: number, providerElapsed = 0) => ({
    readId: String(seconds), status: 'official', elapsedSeconds: providerElapsed,
    timestamp: new Date(Date.parse(gunStart) + seconds * 1000).toISOString(),
    occurredAt: new Date(Date.parse(gunStart) + seconds * 1000).toISOString(),
  });
  const snapshot: any = {
    identity: { bib: '1001' }, raceState: { status: 'not_started' },
    reads: {
      swim_start: at(1), swim_finish: at(1042), bike_start: at(1555),
      bike_finish: at(3243), run_start: at(4110), run_finish: null,
    },
    splits: [], calculated: {}, splitRankings: {}, sections: [], location: null,
  };
  const result = recalculateAthleteSnapshot(snapshot, contest, '2026-08-08T13:00:00.000Z');
  assert.deepEqual(result.splits.map((split) => split.overallElapsedSeconds), [1, 1042, 1555, 3243, 4110, null]);
  assert.deepEqual(result.splits.map((split) => split.legElapsedSeconds), [0, 1041, 0, 1688, 0, null]);
  assert.deepEqual(result.splits.map((split) => split.sectionElapsedSeconds), [1, 1041, 513, 1688, 867, null]);
  assert.deepEqual(result.sections.map((section) => section.durationSeconds), [1041, 513, 1688, 867, 90]);
  assert.equal(result.raceState.resolved?.liveOverallElapsedMs, 4_200_000);
  assert.equal(result.raceState.resolved?.currentSectionElapsedMs, 90_000);

  const finished = recalculateAthleteSnapshot({
    ...snapshot,
    reads: { ...snapshot.reads, run_finish: at(4800) },
  }, contest, '2026-08-08T15:00:00.000Z');
  assert.equal(finished.raceState.resolved?.liveOverallElapsedMs, 4_800_000);
  assert.equal(finished.raceState.resolved?.finalElapsedMs, 4_800_000);
  assert.equal(finished.calculated.overallSeconds, 4800);
});

test('a valid custom configured split keeps an athlete on course during rebuild', () => {
  const contest: any = {
    raceType: 'swimathon',
    totalDistanceKm: 1.9,
    startConfiguration: { mode: 'GUN', gunStartTime: '2026-08-07T09:20:00.000Z' },
    splits: [
      { key: 'swim_start', displayName: 'START', legType: 'swim', cumulativeDistanceKm: 0, distanceInLegKm: 0, isStart: true },
      { key: 'swim_1_km', displayName: 'Swim 1 km', legType: 'swim', cumulativeDistanceKm: 1, distanceInLegKm: 1 },
      { key: 'swim_finish', displayName: 'FINISH', legType: 'swim', cumulativeDistanceKm: 1.9, distanceInLegKm: 1.9, isFinish: true },
    ],
    legs: [{ type: 'swim', distanceKm: 1.9 }],
    sections: [],
  };
  const snapshot: any = {
    updatedAt: '2026-08-07T09:25:45.619Z',
    raceState: { status: 'not_started' },
    reads: {
      swim_start: null,
      swim_1_km: { readId: 'read-1km', status: 'valid', elapsedSeconds: 345.619, timestamp: '2026-08-07T09:25:45.619Z' },
      swim_finish: null,
    },
    splits: [],
    calculated: {},
    splitRankings: {},
    sections: [],
    location: null,
  };

  const result = recalculateAthleteSnapshot(snapshot, contest, '2026-08-07T10:00:00.000Z');
  assert.equal(result.raceState.status, 'swimming');
  assert.equal(result.raceState.distanceCompletedKm, 1);
  assert.equal(result.raceState.lastReadAt, '2026-08-07T09:25:45.619Z');
});

test('chip start advances the canonical state while a reversed finish remains invalid', () => {
  const contest: any = {
    raceType: 'swimathon', totalDistanceKm: 1.9,
    timezone: 'Asia/Kolkata',
    startConfiguration: { mode: 'CHIP', gunStartTime: '2026-08-07T13:20:00.000Z' },
    splits: [
      { key: 'swim_start', providerSplitId: 'start', providerTimingPointId: 'shared', displayName: 'START', legType: 'swim', order: 1, cumulativeDistanceKm: 0, distanceInLegKm: 0, isStart: true },
      { key: 'swim_1_km', providerSplitId: 'one-km', providerTimingPointId: 'one-km-mat', displayName: '1 km', legType: 'swim', order: 2, cumulativeDistanceKm: 1, distanceInLegKm: 1 },
      { key: 'swim_finish', providerSplitId: 'finish', providerTimingPointId: 'shared', displayName: 'FINISH', legType: 'swim', order: 3, cumulativeDistanceKm: 1.9, distanceInLegKm: 1.9, isFinish: true },
    ],
    legs: [{ type: 'swim', displayName: 'Swim', distanceKm: 1.9 }], sections: [],
  };
  const reading = (readId: string, status: string, elapsedSeconds: number, timestamp: string, passNumber: number) => ({
    readId, status, elapsedSeconds, timestamp, occurredAt: timestamp, timeOfDay: timestamp.slice(11, 19), passNumber,
  });
  const snapshot: any = {
    updatedAt: '2026-08-07T13:22:03.000Z',
    raceState: { status: 'not_started' },
    startTiming: {
      officialStartTime: '2026-08-07T13:23:53.000Z', chipStartDetectionTime: '2026-08-07T13:23:53.000Z',
      startTimeSource: 'CHIP', startTimeLocked: true, acceptedReadId: 'start', startStatus: 'ON_COURSE',
      updatedAt: '2026-08-07T13:23:53.000Z', startInferenceSource: 'reader',
    },
    reads: {
      swim_start: reading('start', 'valid', 0, '2026-08-07T13:23:53.000Z', 1),
      swim_1_km: reading('one-km', 'valid', 1090, '2026-08-07T13:42:03.000Z', 1),
      swim_finish: reading('reversed-finish', 'invalid', 0, '2026-08-07T13:23:53.000Z', 2),
    },
    splits: [], calculated: {}, splitRankings: {}, sections: [], location: null,
  };
  const result = recalculateAthleteSnapshot(snapshot, contest, '2026-08-07T13:45:00.000Z');
  assert.equal(result.raceState.status, 'swimming');
  assert.equal(result.raceState.resolved?.status, 'ON_COURSE');
  assert.equal(result.raceState.resolved?.currentSplit?.name, '1 km');
  assert.equal(result.raceState.resolved?.nextExpectedSplit?.name, 'FINISH');
  assert.equal(result.raceState.resolved?.currentSplit?.elapsedSeconds, 1090);
  assert.equal(result.raceState.resolved?.athleteStartTime, '2026-08-07T13:23:53.000Z');
  assert.equal(result.raceState.resolved?.currentSplit?.timeOfDay, '19:12:03');
  assert.equal(result.raceState.resolved?.officialDistanceKm, 1);
  assert.equal(result.raceState.resolved?.distanceRemainingKm, 0.8999999999999999);
  assert.equal(result.raceState.resolved?.predictionSource, 'LIVE_SPLIT_PACE');
  assert.equal(result.raceState.resolved?.predictedPaceSecondsPerKm, 1090);
  assert.equal(result.splits.find((split) => split.splitKey === 'swim_1_km')?.sectionSeconds, 1090);
  assert.equal(result.splits.find((split) => split.splitKey === 'swim_1_km')?.paceSecondsPer100m, 109);
  assert.equal(result.raceState.resolved?.splits.find((split) => split.name === 'FINISH')?.status, 'INVALID');
  assert.equal(result.calculated.overallSeconds, null);
});

test('accepted chip start immediately sets swim, current START, and next 1 km', () => {
  const contest: any = {
    raceType: 'swimathon', totalDistanceKm: 1.9,
    timezone: 'Asia/Kolkata',
    startConfiguration: { mode: 'CHIP', gunStartTime: '2026-08-07T13:20:00.000Z' },
    splits: [
      { key: 'swim_start', providerSplitId: 'start', providerTimingPointId: 'shared', displayName: 'START', legType: 'swim', order: 1, cumulativeDistanceKm: 0, distanceInLegKm: 0, isStart: true },
      { key: 'swim_1_km', providerSplitId: 'one-km', providerTimingPointId: 'one-km-mat', displayName: '1 km', legType: 'swim', order: 2, cumulativeDistanceKm: 1, distanceInLegKm: 1 },
      { key: 'swim_finish', providerSplitId: 'finish', providerTimingPointId: 'shared', displayName: 'FINISH', legType: 'swim', order: 3, cumulativeDistanceKm: 1.9, distanceInLegKm: 1.9, isFinish: true },
    ], legs: [{ type: 'swim', displayName: 'Swim', distanceKm: 1.9 }], sections: [],
  };
  const snapshot: any = {
    updatedAt: '2026-08-07T13:23:53.000Z', raceState: { status: 'not_started' },
    startTiming: { officialStartTime: '2026-08-07T13:23:53.000Z', chipStartDetectionTime: '2026-08-07T13:23:53.000Z', startTimeSource: 'CHIP', startTimeLocked: true, acceptedReadId: 'start', startStatus: 'ON_COURSE', updatedAt: '2026-08-07T13:23:53.000Z', startInferenceSource: 'reader' },
    reads: { swim_start: { readId: 'start', status: 'valid', elapsedSeconds: 0, timestamp: '2026-08-07T13:23:53.000Z', occurredAt: '2026-08-07T13:23:53.000Z', timeOfDay: '13:23:53', passNumber: 1 }, swim_1_km: null, swim_finish: null },
    splits: [], calculated: {}, splitRankings: {}, sections: [], location: null,
  };
  const result = recalculateAthleteSnapshot(snapshot, contest, '2026-08-07T13:25:53.000Z');
  assert.equal(result.raceState.status, 'swimming');
  assert.equal(result.raceState.resolved?.currentLeg, 'swim');
  assert.equal(result.raceState.resolved?.currentSplit?.name, 'START');
  assert.equal(result.raceState.resolved?.nextExpectedSplit?.name, '1 km');
  assert.equal(result.raceState.resolved?.lastOfficialReadAt, '2026-08-07T13:23:53.000Z');
  assert.equal(result.raceState.resolved?.eventTimezone, 'Asia/Kolkata');
  assert.equal(result.raceState.resolved?.positionSource, 'OFFICIAL_TIMING_PREDICTION');
  assert.equal(result.raceState.resolved?.predictionAnchorDistanceKm, 0);
  assert.equal(result.raceState.resolved?.nextSplitDistanceKm, 1);
  assert.equal(result.raceState.resolved?.predictionSource, 'CONTEST_DEFAULT');
  assert.equal(result.raceState.resolved?.predictedPaceSecondsPerKm, 1800);
  assert.equal(result.raceState.resolved?.estimatedDistanceKm, 120 / 1800);
  assert.equal(result.raceState.resolved?.etaNextSplit, '2026-08-07T13:53:53.000Z');
  assert.equal(result.raceState.resolved?.estimatedElapsedAtNextSplitSeconds, 1800);
  assert.equal(result.raceState.resolved?.estimatedSecondsToNextSplit, 1680);
  assert.equal(result.raceState.resolved?.estimatedFinishTime, '2026-08-07T14:20:53.000Z');
  assert.equal(result.raceState.resolved?.estimatedFinishElapsedSeconds, 3420);
  assert.deepEqual(result.raceState.resolved?.splits.map((split) => split.status), ['COMPLETED', 'CURRENT', 'PENDING']);
});

test('split pace uses cumulative time and configured distance within each sport leg', () => {
  const contest: any = {
    raceType: 'triathlon', totalDistanceKm: 52, timezone: 'Asia/Kolkata',
    splits: [
      { key: 'swim_start', displayName: 'Start', legType: 'swim', order: 1, cumulativeDistanceKm: 0, distanceInLegKm: 0, isStart: true },
      { key: 'swim_finish', displayName: 'Swim Finish', legType: 'swim', order: 2, cumulativeDistanceKm: 2, distanceInLegKm: 2 },
      { key: 'bike_start', displayName: 'Bike Start', legType: 'bike', order: 3, cumulativeDistanceKm: 2, distanceInLegKm: 0 },
      { key: 'bike_20', displayName: 'Bike 20 KM', legType: 'bike', order: 4, cumulativeDistanceKm: 22, distanceInLegKm: 20 },
      { key: 'bike_finish', displayName: 'Bike Finish', legType: 'bike', order: 5, cumulativeDistanceKm: 42, distanceInLegKm: 40 },
      { key: 'run_start', displayName: 'Run Start', legType: 'run', order: 6, cumulativeDistanceKm: 42, distanceInLegKm: 0 },
      { key: 'run_5', displayName: 'Run 5 KM', legType: 'run', order: 7, cumulativeDistanceKm: 47, distanceInLegKm: 5 },
    ],
    legs: [{ type: 'swim', distanceKm: 2 }, { type: 'bike', distanceKm: 40 }, { type: 'run', distanceKm: 10 }],
    sections: [
      { key: 'swim', sectionType: 'leg', order: 1, startSplitKey: 'swim_start', finishSplitKey: 'swim_finish' },
      { key: 't1', sectionType: 'transition', order: 2, startSplitKey: 'swim_finish', finishSplitKey: 'bike_start' },
      { key: 'bike', sectionType: 'leg', order: 3, startSplitKey: 'bike_start', finishSplitKey: 'bike_finish' },
      { key: 't2', sectionType: 'transition', order: 4, startSplitKey: 'bike_finish', finishSplitKey: 'run_start' },
      { key: 'run', sectionType: 'leg', order: 5, startSplitKey: 'run_start', finishSplitKey: 'run_finish' },
    ],
  };
  const read = (elapsedSeconds: number) => ({ readId: String(elapsedSeconds), status: 'valid', elapsedSeconds, timestamp: `2026-08-07T00:00:00.000Z`, occurredAt: `2026-08-07T00:00:00.000Z` });
  const result = recalculateAthleteSnapshot({
    identity: { bib: '1' }, updatedAt: '2026-08-07T00:00:00.000Z', raceState: { status: 'running' },
    reads: {
      swim_start: read(0), swim_finish: read(2400),
      bike_start: read(2700), bike_20: { ...read(5100), segmentElapsedSeconds: 2400 }, bike_finish: { ...read(7500), segmentElapsedSeconds: 2400 },
      run_start: read(7800), run_5: { ...read(9480), segmentElapsedSeconds: 1680 },
    }, splits: [], calculated: {}, splitRankings: {}, sections: [], location: null,
  } as any, contest, '2026-08-07T03:00:00.000Z');
  const byKey = new Map(result.splits.map((row) => [row.splitKey, row]));
  assert.equal(result.raceState.resolved?.totalDistanceKm, 52);
  assert.equal(byKey.get('swim_start')?.paceSecondsPer100m, null);
  assert.equal(byKey.get('swim_finish')?.paceSecondsPer100m, 120);
  assert.equal(byKey.get('bike_start')?.speedKmh, null);
  assert.equal(byKey.get('bike_20')?.speedKmh, 30);
  assert.equal(byKey.get('bike_finish')?.speedKmh, 30);
  assert.equal(byKey.get('run_start')?.paceSecondsPerKm, null);
  assert.equal(byKey.get('run_5')?.paceSecondsPerKm, 336);
});

test('triathlon prediction keeps leg and cumulative distances separate and stops at the next unconfirmed checkpoint', () => {
  const contest: any = {
    raceType: 'triathlon', totalDistanceKm: 52, timezone: 'Asia/Kolkata',
    startConfiguration: { mode: 'CHIP', gunStartTime: '2026-08-08T05:30:00.000Z' },
    splits: [
      { key: 'swim_start', displayName: 'Start', legType: 'swim', order: 1, cumulativeDistanceKm: 0, distanceInLegKm: 0, isStart: true },
      { key: 'swim_finish', displayName: 'Swim Finish', legType: 'swim', order: 2, cumulativeDistanceKm: 2, distanceInLegKm: 2 },
      { key: 'bike_start', displayName: 'Bike Start', legType: 'bike', order: 3, cumulativeDistanceKm: 2, distanceInLegKm: 0 },
      { key: 'bike_finish', displayName: 'Bike Finish', legType: 'bike', order: 4, cumulativeDistanceKm: 42, distanceInLegKm: 40 },
      { key: 'run_start', displayName: 'Run Start', legType: 'run', order: 5, cumulativeDistanceKm: 42, distanceInLegKm: 0 },
      { key: 'run_finish', displayName: 'Run Finish', legType: 'run', order: 6, cumulativeDistanceKm: 52, distanceInLegKm: 10, isFinish: true },
    ],
    legs: [{ type: 'swim', distanceKm: 2 }, { type: 'bike', distanceKm: 40 }, { type: 'run', distanceKm: 10 }], sections: [],
  };
  const start = { readId: 'start', status: 'valid', elapsedSeconds: 0, timestamp: '2026-08-08T05:30:00.000Z', occurredAt: '2026-08-08T05:30:00.000Z' };
  const snapshot: any = {
    identity: { bib: '1001' }, updatedAt: start.timestamp, raceState: { status: 'swimming' },
    startTiming: { officialStartTime: start.timestamp, chipStartDetectionTime: start.timestamp, startTimeSource: 'CHIP', startTimeLocked: true, acceptedReadId: 'start', startStatus: 'ON_COURSE' },
    reads: { swim_start: start, swim_finish: null, bike_start: null, bike_finish: null, run_start: null, run_finish: null },
    splits: [], calculated: {}, splitRankings: {}, sections: [], location: null,
  };
  const result = recalculateAthleteSnapshot(snapshot, contest, '2026-08-08T08:30:00.000Z');
  const resolved = result.raceState.resolved;
  assert.equal(resolved?.status, 'ON_COURSE');
  assert.equal(resolved?.currentLeg, 'swim');
  assert.equal(resolved?.officialDistanceKm, 0);
  assert.equal(resolved?.estimatedDistanceKm, 2);
  assert.equal(resolved?.officialLegDistanceKm, 0);
  assert.equal(resolved?.estimatedLegDistanceKm, 2);
  assert.equal(resolved?.currentLegProgressRatio, 1);
  assert.equal(resolved?.nextExpectedSplit?.splitKey, 'swim_finish');
  assert.equal(resolved?.awaitingCheckpointConfirmation, true);
  assert.equal(resolved?.courseState, 'WAITING_CHECKPOINT_CONFIRMATION');
  assert.equal(result.location?.courseDistanceKm, 2);
  assert.equal(result.location?.legDistanceKm, 2);
  assert.equal(result.reads.bike_start, null);
});

test('shared transition distance waits for the next leg start without adding race distance', () => {
  const contest: any = {
    raceType: 'triathlon', totalDistanceKm: 52, timezone: 'Asia/Kolkata',
    startConfiguration: { mode: 'CHIP' },
    splits: [
      { key: 'swim_start', displayName: 'Start', legType: 'swim', order: 1, cumulativeDistanceKm: 0, distanceInLegKm: 0, isStart: true },
      { key: 'swim_finish', displayName: 'Swim Finish', legType: 'swim', order: 2, cumulativeDistanceKm: 2, distanceInLegKm: 2 },
      { key: 'bike_start', displayName: 'Bike Start', legType: 'bike', order: 3, cumulativeDistanceKm: 2, distanceInLegKm: 0 },
      { key: 'bike_finish', displayName: 'Bike Finish', legType: 'bike', order: 4, cumulativeDistanceKm: 42, distanceInLegKm: 40 },
      { key: 'run_start', displayName: 'Run Start', legType: 'run', order: 5, cumulativeDistanceKm: 42, distanceInLegKm: 0 },
      { key: 'run_finish', displayName: 'Run Finish', legType: 'run', order: 6, cumulativeDistanceKm: 52, distanceInLegKm: 10, isFinish: true },
    ],
    legs: [{ type: 'swim', distanceKm: 2 }, { type: 'bike', distanceKm: 40 }, { type: 'run', distanceKm: 10 }],
    sections: [
      { key: 'swim', sectionType: 'leg', order: 1, startSplitKey: 'swim_start', finishSplitKey: 'swim_finish' },
      { key: 't1', sectionType: 'transition', order: 2, startSplitKey: 'swim_finish', finishSplitKey: 'bike_start' },
      { key: 'bike', sectionType: 'leg', order: 3, startSplitKey: 'bike_start', finishSplitKey: 'bike_finish' },
      { key: 't2', sectionType: 'transition', order: 4, startSplitKey: 'bike_finish', finishSplitKey: 'run_start' },
      { key: 'run', sectionType: 'leg', order: 5, startSplitKey: 'run_start', finishSplitKey: 'run_finish' },
    ],
  };
  const read = (id: string, elapsedSeconds: number, timestamp: string) => ({ readId: id, status: 'valid', elapsedSeconds, timestamp, occurredAt: timestamp });
  const start = read('start', 0, '2026-08-08T05:30:00.000Z');
  const snapshot: any = {
    identity: { bib: '1001' }, updatedAt: '2026-08-08T06:10:00.000Z', raceState: { status: 'in_t1' },
    startTiming: { officialStartTime: start.timestamp, chipStartDetectionTime: start.timestamp, startTimeSource: 'CHIP', startTimeLocked: true, acceptedReadId: 'start', startStatus: 'ON_COURSE' },
    reads: { swim_start: start, swim_finish: read('swim-finish', 2400, '2026-08-08T06:10:00.000Z'), bike_start: null, bike_finish: null, run_start: null, run_finish: null },
    splits: [], calculated: {}, splitRankings: {}, sections: [], location: null,
  };
  const resolved = recalculateAthleteSnapshot(snapshot, contest, '2026-08-08T06:20:00.000Z').raceState.resolved;
  assert.equal(resolved?.currentLeg, 'swim');
  assert.equal(resolved?.officialDistanceKm, 2);
  assert.equal(resolved?.estimatedDistanceKm, 2);
  assert.equal(resolved?.nextExpectedSplit?.splitKey, 'bike_start');
  assert.equal(resolved?.courseState, 'LEG_COMPLETE_AWAITING_NEXT_START');
  assert.match(resolved?.statusDetail || '', /Swim Complete.*Bike Start/);

  const staleFinished = recalculateAthleteSnapshot({
    ...snapshot,
    raceState: {
      ...snapshot.raceState,
      status: 'FINISHED',
      statusSource: 'MANUAL_OVERRIDE',
    },
  }, contest, '2026-08-08T06:20:00.000Z');
  assert.deepEqual(
    staleFinished.sections.map((section: any) => [section.key, section.status]),
    [
      ['swim', 'completed'],
      ['t1', 'in_progress'],
      ['bike', 'not_started'],
      ['t2', 'not_started'],
      ['run', 'not_started'],
    ],
  );
});

test('scheduled gun start resolves DNS at the default grace deadline without a timing passage', () => {
  const contest: any = {
    raceType: 'swimathon', totalDistanceKm: 1.9, timezone: 'Asia/Kolkata',
    startConfiguration: { mode: 'GUN', gunStartTime: '2026-08-07T13:20:00.000Z' },
    splits: [
      { key: 'swim_start', displayName: 'START', legType: 'swim', order: 1, cumulativeDistanceKm: 0, distanceInLegKm: 0, isStart: true },
      { key: 'swim_1_km', displayName: '1 km', legType: 'swim', order: 2, cumulativeDistanceKm: 1, distanceInLegKm: 1 },
      { key: 'swim_finish', displayName: 'FINISH', legType: 'swim', order: 3, cumulativeDistanceKm: 1.9, distanceInLegKm: 1.9, isFinish: true },
    ], legs: [{ type: 'swim', distanceKm: 1.9 }], sections: [],
  };
  const snapshot: any = {
    identity: { bib: '1003' }, updatedAt: '2026-08-07T13:20:00.000Z',
    raceState: { status: 'not_started' },
    startTiming: { officialStartTime: '2026-08-07T13:20:00.000Z', startTimeSource: 'GUN', startTimeLocked: true, startStatus: 'START_WINDOW_OPEN' },
    reads: { swim_start: null, swim_1_km: null, swim_finish: null },
    splits: [], calculated: {}, splitRankings: {}, sections: [], location: null,
  };
  const result = recalculateAthleteSnapshot(snapshot, contest, '2026-08-07T14:20:00.000Z');
  assert.equal(result.raceState.status, 'dns');
  assert.equal(result.raceState.resolved?.status, 'DNS');
  assert.equal(result.raceState.resolved?.hasStarted, false);
  assert.equal(result.raceState.resolved?.athleteStartTime, null);
  assert.equal(result.raceState.resolved?.officialRaceElapsedMs, 3_600_000);
  assert.equal(result.raceState.resolved?.athleteElapsedMs, null);
  assert.equal(result.raceState.resolved?.startReaderAt, null);
  assert.deepEqual(result.raceState.resolved?.splits.map((split) => split.status), ['CURRENT', 'PENDING', 'PENDING']);
});

test('gun mode keeps official start and accepted START reader detection separate', () => {
  const contest: any = {
    raceType: 'swimathon', totalDistanceKm: 2, timezone: 'Asia/Kolkata',
    startConfiguration: { mode: 'GUN', gunStartTime: '2026-08-08T11:50:00.000Z' },
    splits: [
      { key: 'swim_start', displayName: 'Start', legType: 'swim', order: 1, cumulativeDistanceKm: 0, distanceInLegKm: 0, isStart: true },
      { key: 'swim_finish', displayName: 'Swim Finish', legType: 'swim', order: 2, cumulativeDistanceKm: 2, distanceInLegKm: 2, isFinish: true },
    ], legs: [{ type: 'swim', distanceKm: 2 }], sections: [],
  };
  const startReaderAt = '2026-08-08T11:50:47.000Z';
  const snapshot: any = {
    identity: { bib: '1001' }, updatedAt: startReaderAt, raceState: { status: 'swimming' },
    startTiming: { officialStartTime: contest.startConfiguration.gunStartTime, chipStartDetectionTime: startReaderAt, startTimeSource: 'GUN', startTimeLocked: true },
    reads: { swim_start: { readId: 'start', status: 'valid', elapsedSeconds: 0, timestamp: startReaderAt, occurredAt: startReaderAt }, swim_finish: null },
    splits: [], calculated: {}, splitRankings: {}, sections: [], location: null,
  };
  const resolved = recalculateAthleteSnapshot(snapshot, contest, '2026-08-08T12:18:26.000Z').raceState.resolved;
  assert.equal(resolved?.officialGunStartAt, contest.startConfiguration.gunStartTime);
  assert.equal(resolved?.startReaderAt, startReaderAt);
  assert.equal(resolved?.acceptedStartAt, startReaderAt);
  assert.equal(resolved?.gunElapsedAtStartMs, 47_000);
  assert.equal(resolved?.officialRaceElapsedMs, 1_706_000);
  assert.equal(resolved?.splits[0]?.timeOfDay, '17:20:47');
});

test('future accepted START evidence is quarantined and cannot put an athlete on course', () => {
  const contest: any = {
    raceType: 'swimathon', totalDistanceKm: 1.9, timezone: 'Asia/Kolkata',
    startConfiguration: { mode: 'CHIP', gunStartTime: '2026-08-08T09:30:00.000Z', timingReorderBufferMs: 2_000 },
    splits: [
      { key: 'swim_start', displayName: 'START', legType: 'swim', order: 1, cumulativeDistanceKm: 0, distanceInLegKm: 0, isStart: true },
      { key: 'swim_finish', displayName: 'FINISH', legType: 'swim', order: 2, cumulativeDistanceKm: 1.9, distanceInLegKm: 1.9, isFinish: true },
    ], legs: [{ type: 'swim', distanceKm: 1.9 }], sections: [],
  };
  const futureStart = '2026-08-08T10:04:01.000Z';
  const snapshot: any = {
    identity: { bib: '1001' }, updatedAt: '2026-08-08T08:41:00.000Z', raceState: { status: 'swimming' },
    startTiming: {
      officialStartTime: futureStart, chipStartDetectionTime: futureStart, startTimeSource: 'CHIP',
      startTimeLocked: true, acceptedReadId: 'future-start', startPassageId: 'future-passage', startStatus: 'ON_COURSE',
    },
    reads: {
      swim_start: { readId: 'future-start', status: 'valid', elapsedSeconds: 0, timestamp: futureStart, occurredAt: futureStart },
      swim_finish: null,
    }, splits: [], calculated: {}, splitRankings: {}, sections: [], location: null,
  };
  const result = recalculateAthleteSnapshot(snapshot, contest, '2026-08-08T08:42:00.000Z');
  assert.equal(result.reads.swim_start, null);
  assert.equal(result.raceState.status, 'not_started');
  assert.equal(result.raceState.resolved?.status, 'WAITING_CHIP_START');
  assert.equal(result.raceState.resolved?.hasStarted, false);
  assert.equal(result.raceState.resolved?.athleteStartTime, null);
  assert.equal(result.raceState.resolved?.lastOfficialReadAt, null);
});

test('CHIP mode never starts from a downstream checkpoint without accepted START evidence', () => {
  const contest: any = {
    raceType: 'swimathon', totalDistanceKm: 1.9, timezone: 'Asia/Kolkata',
    startConfiguration: { mode: 'CHIP', gunStartTime: '2026-08-08T09:30:00.000Z', timingReorderBufferMs: 2_000 },
    splits: [
      { key: 'swim_start', displayName: 'START', legType: 'swim', order: 1, cumulativeDistanceKm: 0, distanceInLegKm: 0, isStart: true },
      { key: 'swim_1_km', displayName: '1 KM', legType: 'swim', order: 2, cumulativeDistanceKm: 1, distanceInLegKm: 1 },
      { key: 'swim_finish', displayName: 'FINISH', legType: 'swim', order: 3, cumulativeDistanceKm: 1.9, distanceInLegKm: 1.9, isFinish: true },
    ], legs: [{ type: 'swim', distanceKm: 1.9 }], sections: [],
  };
  const snapshot: any = {
    identity: { bib: '1002' }, updatedAt: '2026-08-08T09:40:00.000Z', raceState: { status: 'swimming' },
    startTiming: { officialStartTime: null, chipStartDetectionTime: null, startTimeSource: null, startTimeLocked: false, acceptedReadId: null, startStatus: 'NO_START_DETECTION' },
    reads: {
      swim_start: null,
      swim_1_km: { readId: 'orphan-1km', status: 'valid', elapsedSeconds: 600, timestamp: '2026-08-08T09:40:00.000Z', occurredAt: '2026-08-08T09:40:00.000Z' },
      swim_finish: null,
    }, splits: [], calculated: {}, splitRankings: {}, sections: [], location: null,
  };
  const result = recalculateAthleteSnapshot(snapshot, contest, '2026-08-08T09:41:00.000Z');
  assert.equal(result.reads.swim_1_km, null);
  assert.equal(result.raceState.status, 'not_started');
  assert.equal(result.raceState.resolved?.status, 'WAITING_CHIP_START');
  assert.equal(result.raceState.resolved?.hasStarted, false);
  assert.equal(result.raceState.resolved?.athleteStartTime, null);
  assert.equal(result.raceState.resolved?.lastOfficialReadAt, null);
  assert.equal(result.raceState.resolved?.nextExpectedSplit?.name, 'START');
});

test('a stale finished flag cannot finish an athlete and DNS applies at the grace deadline', () => {
  const contest: any = {
    raceType: 'swimathon', totalDistanceKm: 1.9, timezone: 'Asia/Kolkata',
    startConfiguration: { mode: 'GUN', gunStartTime: '2026-08-07T13:20:00.000Z' },
    splits: [
      { key: 'swim_start', displayName: 'START', legType: 'swim', order: 1, cumulativeDistanceKm: 0, distanceInLegKm: 0, isStart: true },
      { key: 'swim_finish', displayName: 'FINISH', legType: 'swim', order: 2, cumulativeDistanceKm: 1.9, distanceInLegKm: 1.9, isFinish: true },
    ], legs: [{ type: 'swim', distanceKm: 1.9 }], sections: [],
  };
  const snapshot: any = {
    identity: { bib: '1003' }, updatedAt: '2026-08-07T13:20:00.000Z',
    raceState: { status: 'finished' },
    startTiming: { officialStartTime: '2026-08-07T13:20:00.000Z', startTimeSource: 'GUN', startTimeLocked: true, startStatus: 'START_WINDOW_OPEN' },
    reads: { swim_start: null, swim_finish: null }, splits: [], calculated: {}, splitRankings: {}, sections: [], location: null,
  };
  const result = recalculateAthleteSnapshot(snapshot, contest, '2026-08-07T14:20:00.000Z');
  assert.equal(result.raceState.status, 'dns');
  assert.equal(result.raceState.resolved?.status, 'DNS');
});

test('valid FINISH freezes official result time, progress and predictions', () => {
  const contest: any = {
    raceType: 'swimathon', totalDistanceKm: 1.9, timezone: 'Asia/Kolkata',
    startConfiguration: { mode: 'CHIP', gunStartTime: '2026-08-07T14:50:00.000Z' },
    splits: [
      { key: 'swim_start', displayName: 'START', legType: 'swim', order: 1, cumulativeDistanceKm: 0, distanceInLegKm: 0, isStart: true },
      { key: 'swim_1_km', displayName: '1 km', legType: 'swim', order: 2, cumulativeDistanceKm: 1, distanceInLegKm: 1 },
      { key: 'swim_finish', displayName: 'FINISH', legType: 'swim', order: 3, cumulativeDistanceKm: 1.9, distanceInLegKm: 1.9, isFinish: true },
    ], legs: [{ type: 'swim', distanceKm: 1.9 }], sections: [], cutoffs: { finish: 7200 },
  };
  const read = (elapsedSeconds: number, timestamp: string) => ({ readId: timestamp, status: 'valid', elapsedSeconds, timestamp, occurredAt: timestamp });
  const snapshot: any = {
    identity: { bib: '1002' }, updatedAt: '2026-08-07T15:10:45.000Z', raceState: { status: 'running' },
    startTiming: { officialStartTime: '2026-08-07T14:50:50.000Z', chipStartDetectionTime: '2026-08-07T14:50:50.000Z', startTimeSource: 'CHIP', startTimeLocked: true, acceptedReadId: 'start', startStatus: 'ON_COURSE' },
    reads: {
      swim_start: read(0, '2026-08-07T14:50:50.000Z'),
      swim_1_km: { ...read(613, '2026-08-07T15:01:03.000Z'), segmentElapsedSeconds: 600 },
      swim_finish: { ...read(1195, '2026-08-07T15:10:45.000Z'), timeOfDay: '15:10:45', segmentElapsedSeconds: 582 },
    },
    splits: [], calculated: {}, splitRankings: {}, sections: [], location: null,
  };
  const result = recalculateAthleteSnapshot(snapshot, contest, '2026-08-07T18:00:00.000Z');
  const resolved = result.raceState.resolved;
  assert.equal(resolved?.status, 'FINISHED');
  assert.equal(resolved?.finalElapsedMs, 1_195_000);
  assert.equal(resolved?.gunElapsedMs, 1_245_000);
  assert.equal(resolved?.officialResultElapsedMs, 1_195_000);
  assert.equal(resolved?.finishTimeOfDay, '20:40:45');
  assert.equal(result.splits.find((split) => split.splitKey === 'swim_1_km')?.sectionSeconds, 600);
  assert.equal(result.splits.find((split) => split.splitKey === 'swim_finish')?.sectionSeconds, 582);
  assert.equal(resolved?.officialProgressRatio, 1);
  assert.equal(resolved?.estimatedProgressRatio, 1);
  assert.equal(resolved?.etaNextSplit, null);
  assert.equal(resolved?.estimatedFinishTime, null);
  assert.equal(resolved?.predictionSource, 'NO_ESTIMATE');
  assert.equal(resolved?.nextExpectedSplit, null);
});

test('CHIP rolling start ranks every board by individual net time while retaining gun diagnostics', () => {
  const gunStart = '2026-08-10T01:00:00.000Z'; // 06:30 Asia/Kolkata
  const contest: any = {
    providerContestUuid: 'rolling-contest', raceType: 'running', totalDistanceKm: 10,
    timezone: 'Asia/Kolkata', startConfiguration: { mode: 'CHIP', gunStartTime: gunStart },
    splits: [
      { key: 'run_start', providerSplitId: 'start', displayName: 'Start', legType: 'run', order: 1, cumulativeDistanceKm: 0, distanceInLegKm: 0, isStart: true, isRaceStart: true, rankingEnabled: true },
      { key: 'run_finish', providerSplitId: 'finish', displayName: 'Finish', legType: 'run', order: 2, cumulativeDistanceKm: 10, distanceInLegKm: 10, isFinish: true, isRaceFinish: true, rankingEnabled: true },
    ],
    legs: [{ type: 'run', order: 1, startSplitKey: 'run_start', finishSplitKey: 'run_finish', distanceKm: 10 }],
    transitions: [], sections: [], cutoffs: {},
  };
  const athlete = (bib: string, providerParticipantUuid: string, startAt: string, finishAt: string) => recalculateAthleteSnapshot({
    schemaVersion: 1, eventId: 'rolling-event', buildVersion: 'rolling-build', updatedAt: finishAt,
    contestUuid: contest.providerContestUuid, courseVersion: 1, timingVersion: 2, leaderboardVersion: 0,
    identity: {
      participantUuid: `rolling:${bib}`, providerParticipantUuid, bib, displayName: `Athlete ${bib}`,
      genderKey: 'male', ageGroupKey: '31-40', clubName: 'BERGMAN', countryCode: 'IN', photoUrl: null,
    },
    bergmanIdentity: {}, raceState: { status: 'running' },
    startTiming: { officialStartTime: startAt, chipStartDetectionTime: startAt, startTimeSource: 'CHIP', startTimeLocked: true, acceptedReadId: `${bib}:start`, startStatus: 'ON_COURSE' },
    reads: {
      run_start: { readId: `${bib}:start`, status: 'official', elapsedSeconds: 0, timestamp: startAt, occurredAt: startAt, source: 'final' },
      run_finish: { readId: `${bib}:finish`, status: 'official', elapsedSeconds: 0, timestamp: finishAt, occurredAt: finishAt, source: 'final' },
    },
    calculated: {}, sections: [], splits: [], splitRankings: {}, overallRanking: {}, location: null,
    versions: { course: 1, participant: 1, timing: 2, profile: 1, leaderboard: 0 },
  } as any, contest, finishAt);
  const athleteA = athlete('1001', 'provider-a', '2026-08-10T01:00:10.000Z', '2026-08-10T06:00:10.000Z');
  const athleteB = athlete('1002', 'provider-b', '2026-08-10T01:05:00.000Z', '2026-08-10T06:02:00.000Z');
  assert.equal(athleteA.raceState.resolved?.officialTimingMode, 'CHIP');
  assert.equal(athleteA.raceState.resolved?.officialElapsedMs, 18_000_000);
  assert.equal(athleteA.raceState.resolved?.gunElapsedMs, 18_010_000);
  assert.equal(athleteA.raceState.resolved?.chipElapsedMs, 18_000_000);
  assert.equal(athleteA.raceState.resolved?.startDelayMs, 10_000);
  assert.equal(athleteB.raceState.resolved?.officialElapsedMs, 17_820_000);
  assert.equal(athleteB.raceState.resolved?.startDelayMs, 300_000);

  const artifacts = buildCanonicalLeaderboards({
    eventId: 'rolling-event', buildVersion: 'rolling-board', snapshots: [athleteA, athleteB],
    course: {
      schemaVersion: 1, eventId: 'rolling-event', buildVersion: 'rolling-board', updatedAt: athleteB.updatedAt,
      source: 'feibot_cloud', provider: 'feibot', timezone: 'Asia/Kolkata', courseVersion: 1, contests: [contest],
      validation: { schemaVersion: 1, eventId: 'rolling-event', buildVersion: 'rolling-board', updatedAt: athleteB.updatedAt, valid: true, errors: [], warnings: [] },
    },
    updatedAt: athleteB.updatedAt,
  });
  for (const mode of ['overall', 'gender', 'age', 'club']) {
    const board = artifacts.leaderboards.find((candidate) => candidate.mode === mode);
    assert.deepEqual(board?.entries.map((row) => [row.bib, row.elapsedSeconds]), [
      ['1002', 17_820],
      ['1001', 18_000],
    ]);
    assert.equal(board?.entries[0]?.officialTimingMode, 'CHIP');
    assert.equal(board?.entries[0]?.officialElapsedSeconds, 17_820);
  }
  const finishBoard = artifacts.splitLeaderboards.find((candidate) => candidate.splitKey === 'run_finish' && candidate.mode === 'overall');
  assert.deepEqual(finishBoard?.entries.map((row) => [row.bib, row.elapsedSeconds]), [
    ['1002', 17_820],
    ['1001', 18_000],
  ]);
});

test('normal live imports advance Start, Swim Finish and Bike Start without resetting canonical in GUN and CHIP modes', () => {
  const gunStart = '2026-08-09T14:10:00.000Z'; // 19:40:00 Asia/Kolkata
  const baseContest: any = {
    providerContestUuid: '1TuQz5ok', raceType: 'triathlon', totalDistanceKm: 52,
    timezone: 'Asia/Kolkata',
    splits: [
      { key: 'swim_start', providerSplitId: 'start', displayName: 'Start', legType: 'swim', order: 1, distanceInLegKm: 0, cumulativeDistanceKm: 0, isStart: true, isRaceStart: true },
      { key: 'swim_finish', providerSplitId: 'swim-finish', displayName: 'Swim Finish', legType: 'swim', order: 2, distanceInLegKm: 2, cumulativeDistanceKm: 2 },
      { key: 'bike_start', providerSplitId: 'bike-start', displayName: 'Bike Start', legType: 'bike', order: 3, distanceInLegKm: 0, cumulativeDistanceKm: 2 },
      { key: 'bike_finish', providerSplitId: 'bike-finish', displayName: 'Bike Finish', legType: 'bike', order: 4, distanceInLegKm: 40, cumulativeDistanceKm: 42 },
      { key: 'run_start', providerSplitId: 'run-start', displayName: 'Run Start', legType: 'run', order: 5, distanceInLegKm: 0, cumulativeDistanceKm: 42 },
      { key: 'run_finish', providerSplitId: 'run-finish', displayName: 'Run Finish', legType: 'run', order: 6, distanceInLegKm: 10, cumulativeDistanceKm: 52, isFinish: true, isRaceFinish: true },
    ],
    legs: [
      { type: 'swim', order: 1, startSplitKey: 'swim_start', finishSplitKey: 'swim_finish', distanceKm: 2 },
      { type: 'bike', order: 3, startSplitKey: 'bike_start', finishSplitKey: 'bike_finish', distanceKm: 40 },
      { type: 'run', order: 5, startSplitKey: 'run_start', finishSplitKey: 'run_finish', distanceKm: 10 },
    ],
    transitions: [
      { key: 't1', type: 't1', order: 2, startSplitKey: 'swim_finish', finishSplitKey: 'bike_start' },
      { key: 't2', type: 't2', order: 4, startSplitKey: 'bike_finish', finishSplitKey: 'run_start' },
    ],
    sections: [], cutoffs: {},
  };
  const acceptedReadIdsByMode: Record<string, string[]> = {};
  for (const mode of ['GUN', 'CHIP'] as const) {
    const contest = {
      ...baseContest,
      startConfiguration: { mode, gunStartTime: gunStart, dnsGraceMinutes: 5 },
    };
    const before: any = {
      schemaVersion: 1, eventId: '5YoMTuJ23ocD4iyZ8ADB', buildVersion: `timing-zero-${mode.toLowerCase()}`, updatedAt: gunStart,
      contestUuid: '1TuQz5ok', courseVersion: 1, timingVersion: 0, leaderboardVersion: 0,
      identity: { participantUuid: 'race:6ispfkqi:1tuqz5ok:1001', providerParticipantUuid: 'provider-1001', bib: '1001' },
      bergmanIdentity: {}, raceState: { status: 'not_started' },
      startTiming: { officialStartTime: gunStart, startTimeSource: mode, startTimeLocked: true, startStatus: 'NOT_STARTED' },
      reads: Object.fromEntries(contest.splits.map((split: any) => [split.key, null])),
      calculated: {}, sections: [], splits: [], splitRankings: {}, overallRanking: {}, location: null,
      versions: { course: 1, participant: 1, timing: 0, profile: 1, leaderboard: 0 },
    };

    const currentPrefixOnly = mergeProcessedParticipantLiveSnapshot(before, contest, {
      updatedAt: '2026-08-09T14:12:15.000Z',
      splits: [
        {
          splitKey: 'swim_start', accepted: true, validity: 'Valid',
          acceptedAt: '2026-08-09T14:12:15.000Z', cumulativeSeconds: 135,
          gunSeconds: 135, chipSeconds: 0,
        },
        {
          splitKey: 'swim_finish', accepted: true, validity: 'Valid',
          acceptedAt: '2026-08-09T14:25:02.000Z', cumulativeSeconds: 902,
        },
        {
          splitKey: 'bike_start', accepted: true, validity: 'Valid',
          acceptedAt: '2026-08-09T14:32:30.000Z', cumulativeSeconds: 1_350,
        },
      ],
    }, '2026-08-09T14:12:15.000Z');
    assert.equal(currentPrefixOnly.timingVersion, 1, `${mode} future provider rows must not consume timing versions`);
    assert.ok(currentPrefixOnly.reads.swim_start);
    assert.equal(currentPrefixOnly.reads.swim_finish, null);
    assert.equal(currentPrefixOnly.reads.bike_start, null);

    // Normal live poll 1: START only. No reset or full rebuild is allowed.
    const afterStart = mergeProcessedParticipantLiveSnapshot(before, contest, {
      updatedAt: '2026-08-09T14:12:15.000Z',
      splits: [{
        splitKey: 'swim_start', accepted: true, validity: 'Valid',
        acceptedAt: '2026-08-09T14:12:15.000Z', cumulativeSeconds: 135,
        gunSeconds: 135, chipSeconds: 0, timeOfDay: '19:42:15',
      }],
    }, '2026-08-09T14:12:15.000Z');
    assert.equal(afterStart.timingVersion, 1, `${mode} START must advance timingVersion`);
    assert.equal(afterStart.versions.timing, 1);
    assert.ok(afterStart.reads.swim_start);
    assert.equal(afterStart.raceState.resolved?.status, 'ON_COURSE');
    assert.equal(afterStart.raceState.resolved?.startReaderAt, '2026-08-09T14:12:15.000Z');
    assert.equal(afterStart.raceState.resolved?.acceptedStartAt, '2026-08-09T14:12:15.000Z');
    assert.equal(afterStart.raceState.resolved?.gunElapsedAtStartMs, 135_000);
    assert.equal(afterStart.reads.swim_start?.elapsedSeconds, mode === 'GUN' ? 135 : 0);

    // Normal live poll 2: sparse Swim Finish update. START must be retained.
    const afterSwimFinish = mergeProcessedParticipantLiveSnapshot(afterStart, contest, {
      updatedAt: '2026-08-09T14:25:02.000Z',
      splits: [{
        splitKey: 'swim_finish', accepted: true, validity: 'Valid',
        acceptedAt: '2026-08-09T14:25:02.000Z', cumulativeSeconds: 902,
        gunSeconds: 902, chipSeconds: 767, sectionElapsedSeconds: 767,
        timeOfDay: '19:55:02',
      }],
    }, '2026-08-09T14:25:02.000Z');
    assert.equal(afterSwimFinish.timingVersion, 2, `${mode} Swim Finish must advance timingVersion`);
    assert.ok(afterSwimFinish.reads.swim_start, `${mode} sparse update must retain START`);
    assert.ok(afterSwimFinish.reads.swim_finish);
    assert.equal(afterSwimFinish.reads.swim_finish?.elapsedSeconds, mode === 'GUN' ? 902 : 767);
    assert.equal(afterSwimFinish.calculated.swimSeconds, 767);
    assert.equal(afterSwimFinish.raceState.resolved?.lastCompletedSplit?.splitKey, 'swim_finish');
    assert.equal(afterSwimFinish.raceState.resolved?.currentSectionKey, 't1');
    assert.equal(afterSwimFinish.raceState.resolved?.nextExpectedSplit?.splitKey, 'bike_start');

    // Normal live poll 3: sparse Bike Start update. No canonical reset occurs.
    const afterBikeStart = mergeProcessedParticipantLiveSnapshot(afterSwimFinish, contest, {
      updatedAt: '2026-08-09T14:32:30.000Z',
      splits: [{
        splitKey: 'bike_start', accepted: true, validity: 'Corrected',
        acceptedAt: '2026-08-09T14:32:30.000Z', cumulativeSeconds: 1_350,
        gunSeconds: 1_350, chipSeconds: 1_215, sectionElapsedSeconds: 448,
        timeOfDay: '20:02:30',
      }],
    }, '2026-08-09T14:32:30.000Z');
    const bikeResolved = afterBikeStart.raceState.resolved;
    assert.equal(afterBikeStart.timingVersion, 3, `${mode} Bike Start must advance timingVersion`);
    assert.equal(afterBikeStart.versions.timing, 3);
    assert.equal(bikeResolved?.status, 'ON_COURSE');
    assert.equal(bikeResolved?.currentLeg, 'bike');
    assert.equal(bikeResolved?.lastCompletedSplit?.splitKey, 'bike_start');
    assert.equal(bikeResolved?.nextExpectedSplit?.splitKey, 'bike_finish');
    assert.equal(afterBikeStart.sections.find((section) => section.key === 't1')?.status, 'completed');
    assert.equal(afterBikeStart.sections.find((section) => section.key === 't1')?.durationSeconds, 448);
    assert.equal(afterBikeStart.sections.find((section) => section.key === 'bike')?.status, 'in_progress');
    acceptedReadIdsByMode[mode] = ['swim_start', 'swim_finish', 'bike_start'].map(
      (key) => afterBikeStart.reads[key]?.readId || '',
    );

    const muchLater = recalculateAthleteSnapshot(afterBikeStart, contest, '2026-08-10T14:25:02.000Z');
    assert.notEqual(muchLater.raceState.resolved?.status, 'DNS', 'accepted Start evidence is permanent');
  }

  assert.deepEqual(
    acceptedReadIdsByMode.GUN,
    acceptedReadIdsByMode.CHIP,
    'changing timing interpretation must not create or re-import different Feibot reads',
  );
});

test('Bib 1002 processed Run Start persists as current Run state with exact transition durations', () => {
  const gunStart = '2026-08-09T06:05:00.000Z'; // 11:35:00 Asia/Kolkata
  const definitions = [
    ['swim_start', '4uscdYgh', '3SnLaO9I', 1, 'Start', 'swim', 1, 0, 0],
    ['swim_finish', '4RSDJfEL', '3SnLaO9I', 2, 'Swim Finish', 'swim', 2, 2, 2],
    ['bike_start', '3BoGq8U9', '5Oo6F6Fd', 1, 'Bike Start', 'bike', 3, 0, 2],
    ['bike_finish', '3c3jrd9F', '5Oo6F6Fd', 2, 'Bike Finish', 'bike', 4, 40, 42],
    ['run_start', '4R4DBz6h', '5Oo6F6Fd', 3, 'Run Start', 'run', 5, 0, 42],
    ['run_finish', '4DBMkLxV', '3SnLaO9I', 3, 'Run Finish', 'run', 6, 10, 52],
  ] as const;
  const contest: any = {
    providerContestUuid: '1TuQz5ok', raceType: 'triathlon', totalDistanceKm: 52,
    timezone: 'Asia/Kolkata', startConfiguration: { mode: 'GUN', gunStartTime: gunStart },
    splits: definitions.map(([key, providerSplitId, providerTimingPointId, passNumber, displayName, legType, order, distanceInLegKm, cumulativeDistanceKm]) => ({
      key, providerSplitId, providerTimingPointId, passNumber, displayName, legType, order,
      distanceInLegKm, cumulativeDistanceKm,
      rankingEnabled: true,
      isStart: key === 'swim_start', isRaceStart: key === 'swim_start',
      isFinish: key === 'run_finish', isRaceFinish: key === 'run_finish',
    })),
    legs: [
      { type: 'swim', order: 1, startSplitKey: 'swim_start', finishSplitKey: 'swim_finish', distanceKm: 2 },
      { type: 'bike', order: 3, startSplitKey: 'bike_start', finishSplitKey: 'bike_finish', distanceKm: 40 },
      { type: 'run', order: 5, startSplitKey: 'run_start', finishSplitKey: 'run_finish', distanceKm: 10 },
    ],
    transitions: [
      { key: 't1', type: 't1', order: 2, startSplitKey: 'swim_finish', finishSplitKey: 'bike_start' },
      { key: 't2', type: 't2', order: 4, startSplitKey: 'bike_finish', finishSplitKey: 'run_start' },
    ],
    sections: [], cutoffs: { swim: 4_500, bike: 10_800, run: 18_000 },
  };
  const before: any = {
    schemaVersion: 1, eventId: '5YoMTuJ23ocD4iyZ8ADB', buildVersion: 'build-1002', updatedAt: gunStart,
    contestUuid: '1TuQz5ok', courseVersion: 1, timingVersion: 0, leaderboardVersion: 0,
    identity: { participantUuid: 'race:6ispfkqi:1tuqz5ok:1002', providerParticipantUuid: '4CroQ5iP', bib: '1002', chipCode: '111997' },
    bergmanIdentity: {}, raceState: { status: 'not_started' },
    startTiming: { officialStartTime: gunStart, startTimeSource: 'GUN', startTimeLocked: true, startStatus: 'WAITING_START' },
    reads: Object.fromEntries(definitions.map(([key]) => [key, null])), calculated: {}, sections: [], splits: [], splitRankings: {}, overallRanking: {}, location: null,
    versions: { course: 1, participant: 1, timing: 0, profile: 1, leaderboard: 0 },
  };
  const elapsed = [27, 1_914, 2_327, 3_271, 4_134];
  const processed = {
    updatedAt: '2026-08-09T07:14:00.000Z',
    splits: definitions.slice(0, 5).map(([key, splitUuid, timingPointUuid, passNumber], index) => ({
      splitKey: key, splitUuid, timingPointUuid, passNumber, accepted: true, validity: 'Valid',
      acceptedAt: new Date(Date.parse(gunStart) + elapsed[index] * 1_000).toISOString(),
      cumulativeSeconds: elapsed[index], gunSeconds: elapsed[index],
    })),
  };
  const after = mergeProcessedParticipantLiveSnapshot(before, contest, processed, processed.updatedAt);
  const resolved = after.raceState.resolved;
  assert.equal(resolved?.status, 'ON_COURSE');
  assert.equal(resolved?.currentLeg, 'run');
  assert.equal(resolved?.currentSectionKey, 'run');
  assert.equal(resolved?.currentSectionType, 'leg');
  assert.equal(resolved?.currentSectionStatus, 'in_progress');
  assert.equal(resolved?.lastCompletedSplit?.splitKey, 'run_start');
  assert.equal(resolved?.nextExpectedSplit?.splitKey, 'run_finish');
  assert.equal(after.calculated.t1Seconds, 413);
  assert.equal(after.calculated.bikeSeconds, 944);
  assert.equal(after.calculated.t2Seconds, 863);
  assert.equal(after.sections.find((section) => section.key === 't2')?.status, 'completed');
  assert.equal(after.sections.find((section) => section.key === 't2')?.durationSeconds, 863);
  assert.equal(resolved?.predictionAnchorDistanceKm, 42);
  assert.equal(resolved?.nextSplitDistanceKm, 52);
  assert.equal(after.reads.run_finish, null);
  assert.equal(resolved?.cutoff?.activeCutoffKey, 'finish');
  assert.equal(resolved?.cutoff?.displayName, 'Finish Cutoff');
  assert.equal(resolved?.cutoff?.boundarySplitKey, 'run_finish');
  assert.equal(resolved?.cutoff?.officialStatus, 'ON_COURSE');

  const leaderboardArtifacts = buildCanonicalLeaderboards({
    eventId: before.eventId,
    buildVersion: 'timing-build-run-start',
    course: {
      schemaVersion: 1,
      eventId: before.eventId,
      buildVersion: 'timing-build-run-start',
      updatedAt: processed.updatedAt,
      source: 'feibot_cloud',
      provider: 'feibot',
      timezone: 'Asia/Kolkata',
      courseVersion: 1,
      contests: [contest],
      validation: { schemaVersion: 1, eventId: before.eventId, buildVersion: 'timing-build-run-start', updatedAt: processed.updatedAt, valid: true, errors: [], warnings: [] },
    },
    snapshots: [{ ...after, buildVersion: 'timing-build-run-start' }],
    updatedAt: processed.updatedAt,
  });
  const historicalStartRow = leaderboardArtifacts.splitLeaderboards
    .find((board) => board.splitKey === 'swim_start' && board.mode === 'overall')
    ?.entries[0];
  assert.equal(historicalStartRow?.splitKey, 'swim_start');
  assert.equal(historicalStartRow?.splitStatus, 'COMPLETED');
  assert.equal(historicalStartRow?.currentLeg, 'run');
  assert.equal(historicalStartRow?.currentLastSplitKey, 'run_start');
  assert.equal(historicalStartRow?.currentLastSplitOrder, 5);
  assert.equal(historicalStartRow?.timeOfDay, '11:35:27');

  const rankedAthlete = (
    bib: string,
    providerParticipantUuid: string,
    bikeFinishSeconds: number,
    runStartSeconds: number,
  ) => mergeProcessedParticipantLiveSnapshot({
    ...before,
    identity: {
      ...before.identity,
      bib,
      participantUuid: `race:6ispfkqi:1tuqz5ok:${bib}`,
      providerParticipantUuid,
    },
  }, contest, {
    updatedAt: new Date(Date.parse(gunStart) + runStartSeconds * 1_000).toISOString(),
    splits: definitions.slice(0, 5).map(([key, splitUuid, timingPointUuid, passNumber], index) => {
      const elapsedSeconds = [49, 1_900, 2_300, bikeFinishSeconds, runStartSeconds][index];
      return {
        splitKey: key, splitUuid, timingPointUuid, passNumber, accepted: true, validity: 'Valid',
        acceptedAt: new Date(Date.parse(gunStart) + elapsedSeconds * 1_000).toISOString(),
        cumulativeSeconds: elapsedSeconds, gunSeconds: elapsedSeconds,
      };
    }),
  }, new Date(Date.parse(gunStart) + runStartSeconds * 1_000).toISOString());
  const movementArtifacts = buildCanonicalLeaderboards({
    eventId: before.eventId,
    buildVersion: 'timing-build-position-movement',
    course: {
      schemaVersion: 1, eventId: before.eventId, buildVersion: 'timing-build-position-movement',
      updatedAt: '2026-08-09T07:14:12.000Z', source: 'feibot_cloud', provider: 'feibot',
      timezone: 'Asia/Kolkata', courseVersion: 1, contests: [contest],
      validation: { schemaVersion: 1, eventId: before.eventId, buildVersion: 'timing-build-position-movement', updatedAt: '2026-08-09T07:14:12.000Z', valid: true, errors: [], warnings: [] },
    },
    snapshots: [
      rankedAthlete('1001', 'provider-1001', 3_200, 4_112),
      rankedAthlete('1002', 'provider-1002', 3_300, 4_134),
      rankedAthlete('1003', 'provider-1003', 3_100, 4_152),
    ],
    updatedAt: '2026-08-09T07:14:12.000Z',
  });
  const runStartMovement = movementArtifacts.splitLeaderboards
    .find((board) => board.splitKey === 'run_start' && board.mode === 'overall');
  assert.deepEqual(runStartMovement?.entries.map((row) => ({
    bib: row.bib,
    rank: row.rank,
    previousRank: row.previousRank,
    positionDelta: row.positionDelta,
    positionDirection: row.positionDirection,
    positionDisplay: row.positionDisplay,
    gapToLeaderSeconds: row.gapToLeaderSeconds,
    paceDisplay: row.paceDisplay,
  })), [
    { bib: '1001', rank: 1, previousRank: 2, positionDelta: 1, positionDirection: 'UP', positionDisplay: '↑ 1', gapToLeaderSeconds: 0, paceDisplay: null },
    { bib: '1002', rank: 2, previousRank: 3, positionDelta: 1, positionDirection: 'UP', positionDisplay: '↑ 1', gapToLeaderSeconds: 22, paceDisplay: null },
    { bib: '1003', rank: 3, previousRank: 1, positionDelta: -2, positionDirection: 'DOWN', positionDisplay: '↓ 2', gapToLeaderSeconds: 40, paceDisplay: null },
  ]);

  const sparse = mergeProcessedParticipantLiveSnapshot(after, contest, {
    updatedAt: '2026-08-09T07:15:00.000Z',
    splits: [processed.splits[0]],
  }, '2026-08-09T07:15:00.000Z');
  assert.equal(sparse.reads.run_start?.overallElapsedSeconds, 4_134);
  assert.equal(sparse.raceState.resolved?.lastCompletedSplit?.splitKey, 'run_start');

  const corrected = mergeProcessedParticipantLiveSnapshot(sparse, contest, {
    updatedAt: '2026-08-09T07:15:02.000Z',
    splits: [{
      ...processed.splits[4], validity: 'Fixed', cumulativeSeconds: 4_142, gunSeconds: 4_142,
      acceptedAt: new Date(Date.parse(gunStart) + 4_142_000).toISOString(),
    }],
  }, '2026-08-09T07:15:02.000Z');
  assert.equal(corrected.reads.run_start?.overallElapsedSeconds, 4_142);
  assert.equal(corrected.calculated.t2Seconds, 871);

  const finished = mergeProcessedParticipantLiveSnapshot(after, contest, {
    updatedAt: '2026-08-09T08:16:51.000Z',
    splits: [{
      splitKey: 'run_finish', splitUuid: '4DBMkLxV', timingPointUuid: '3SnLaO9I', passNumber: 3,
      accepted: true, validity: 'Valid', acceptedAt: '2026-08-09T08:16:51.000Z',
      cumulativeSeconds: 7_911, gunSeconds: 7_911,
    }],
  }, '2026-08-09T08:16:51.000Z');
  assert.equal(finished.raceState.resolved?.status, 'FINISHED');
  assert.equal(finished.raceState.resolved?.finalSplitAccepted, true);
  assert.equal(finished.raceState.resolved?.finalElapsedMs, 7_911_000);
  assert.equal(finished.calculated.swimSeconds, 1_887);
  assert.equal(finished.calculated.t1Seconds, 413);
  assert.equal(finished.calculated.bikeSeconds, 944);
  assert.equal(finished.calculated.t2Seconds, 863);
  assert.equal(finished.calculated.runSeconds, 3_777);
  assert.equal(finished.calculated.averageSwimPaceSecondsPer100m, 94.35);
  assert.ok(Math.abs(Number(finished.calculated.averageBikeSpeedKmh) - 152.54237288135593) < 1e-9);
  assert.equal(finished.calculated.averageRunPaceSecondsPerKm, 377.7);
  assert.ok(Math.abs(Number(finished.calculated.averageRacePaceSecondsPerKm) - (7_911 / 52)) < 1e-9);
  assert.deepEqual(
    finished.sections.map((section) => [section.key, section.status, section.durationSeconds]),
    [
      ['swim', 'completed', 1_887],
      ['t1', 'completed', 413],
      ['bike', 'completed', 944],
      ['t2', 'completed', 863],
      ['run', 'completed', 3_777],
    ],
  );

  const finishAthlete = (bib: string, providerParticipantUuid: string, finishSeconds: number) => {
    const base = {
      ...after,
      identity: {
        ...after.identity,
        bib,
        participantUuid: `race:6ispfkqi:1tuqz5ok:${bib}`,
        providerParticipantUuid,
      },
    };
    const acceptedAt = new Date(Date.parse(gunStart) + finishSeconds * 1_000).toISOString();
    return mergeProcessedParticipantLiveSnapshot(base, contest, {
      updatedAt: acceptedAt,
      splits: [{
        splitKey: 'run_finish', splitUuid: '4DBMkLxV', timingPointUuid: '3SnLaO9I', passNumber: 3,
        accepted: true, validity: 'Valid', acceptedAt,
        cumulativeSeconds: finishSeconds, gunSeconds: finishSeconds,
      }],
    }, acceptedAt);
  };
  const finishArtifacts = buildCanonicalLeaderboards({
    eventId: before.eventId,
    buildVersion: 'timing-build-finished-summary',
    course: {
      schemaVersion: 1, eventId: before.eventId, buildVersion: 'timing-build-finished-summary',
      updatedAt: '2026-08-09T09:16:43.000Z', source: 'feibot_cloud', provider: 'feibot',
      timezone: 'Asia/Kolkata', courseVersion: 1, contests: [contest],
      validation: { schemaVersion: 1, eventId: before.eventId, buildVersion: 'timing-build-finished-summary', updatedAt: '2026-08-09T09:16:43.000Z', valid: true, errors: [], warnings: [] },
    },
    snapshots: [
      finishAthlete('1001', 'provider-1001', 9_377),
      finishAthlete('1002', 'provider-1002', 7_911),
      finishAthlete('1003', 'provider-1003', 11_503),
    ],
    updatedAt: '2026-08-09T09:16:43.000Z',
  });
  const finalByBib = new Map(finishArtifacts.snapshots.map((snapshot) => [snapshot.identity.bib, snapshot]));
  assert.equal(finalByBib.get('1002')?.finalRank, 1);
  assert.equal(finalByBib.get('1001')?.finalRank, 2);
  assert.equal(finalByBib.get('1003')?.finalRank, 3);
  assert.equal(finalByBib.get('1002')?.finalSummary?.finished, true);
  assert.equal(finalByBib.get('1002')?.finalSummary?.overallSeconds, 7_911);
  assert.equal(finalByBib.get('1002')?.summary?.swimSeconds, 1_887);
  assert.equal(finalByBib.get('1002')?.summary?.t1Seconds, 413);
  assert.equal(finalByBib.get('1002')?.summary?.bikeSeconds, 944);
  assert.equal(finalByBib.get('1002')?.summary?.t2Seconds, 863);
  assert.equal(finalByBib.get('1002')?.summary?.runSeconds, 3_777);
  assert.equal(finalByBib.get('1002')?.display?.overallRankOrdinal, '1st');
  assert.equal(finalByBib.get('1002')?.display?.averageRacePaceLabel, '2:32 /km');
  assert.ok(Math.abs(Number(finalByBib.get('1001')?.averageRacePaceSecondsPerKm) - (9_377 / 52)) < 1e-9);
  assert.ok(Math.abs(Number(finalByBib.get('1003')?.averageRacePaceSecondsPerKm) - (11_503 / 52)) < 1e-9);
});

test('a zero-distance T2 boundary has no fabricated ETA or movement', () => {
  const contest: any = {
    raceType: 'triathlon', totalDistanceKm: 52, timezone: 'Asia/Kolkata',
    startConfiguration: { mode: 'GUN', gunStartTime: '2026-08-09T06:05:00.000Z' },
    splits: [
      { key: 'swim_start', displayName: 'Start', legType: 'swim', order: 1, cumulativeDistanceKm: 0, distanceInLegKm: 0, isStart: true },
      { key: 'swim_finish', displayName: 'Swim Finish', legType: 'swim', order: 2, cumulativeDistanceKm: 2, distanceInLegKm: 2 },
      { key: 'bike_start', displayName: 'Bike Start', legType: 'bike', order: 3, cumulativeDistanceKm: 2, distanceInLegKm: 0 },
      { key: 'bike_finish', displayName: 'Bike Finish', legType: 'bike', order: 4, cumulativeDistanceKm: 42, distanceInLegKm: 40 },
      { key: 'run_start', displayName: 'Run Start', legType: 'run', order: 5, cumulativeDistanceKm: 42, distanceInLegKm: 0 },
      { key: 'run_finish', displayName: 'Run Finish', legType: 'run', order: 6, cumulativeDistanceKm: 52, distanceInLegKm: 10, isFinish: true },
    ],
    legs: [{ type: 'swim', distanceKm: 2 }, { type: 'bike', distanceKm: 40 }, { type: 'run', distanceKm: 10 }],
    transitions: [{ key: 't2', type: 't2', order: 4, startSplitKey: 'bike_finish', finishSplitKey: 'run_start' }],
    sections: [
      { key: 'swim', sectionType: 'leg', order: 1, startSplitKey: 'swim_start', finishSplitKey: 'swim_finish' },
      { key: 't1', sectionType: 'transition', order: 2, startSplitKey: 'swim_finish', finishSplitKey: 'bike_start' },
      { key: 'bike', sectionType: 'leg', order: 3, startSplitKey: 'bike_start', finishSplitKey: 'bike_finish' },
      { key: 't2', sectionType: 'transition', order: 4, startSplitKey: 'bike_finish', finishSplitKey: 'run_start' },
      { key: 'run', sectionType: 'leg', order: 5, startSplitKey: 'run_start', finishSplitKey: 'run_finish' },
    ],
  };
  const at = (seconds: number) => new Date(Date.parse('2026-08-09T06:05:00.000Z') + seconds * 1_000).toISOString();
  const snapshot: any = {
    identity: { bib: '1002' }, updatedAt: '2026-08-09T07:00:00.000Z', raceState: { status: 'running' },
    startTiming: { officialStartTime: '2026-08-09T06:05:00.000Z', startTimeSource: 'GUN', startTimeLocked: true, startStatus: 'ON_COURSE' },
    reads: {
      swim_start: { status: 'official', elapsedSeconds: 27, timestamp: at(27), occurredAt: at(27) },
      swim_finish: { status: 'official', elapsedSeconds: 1914, timestamp: at(1914), occurredAt: at(1914) },
      bike_start: { status: 'official', elapsedSeconds: 2327, timestamp: at(2327), occurredAt: at(2327) },
      bike_finish: { status: 'official', elapsedSeconds: 3271, timestamp: at(3271), occurredAt: at(3271) },
      run_start: null, run_finish: null,
    }, splits: [], calculated: {}, splitRankings: {}, sections: [], location: null,
  };
  const after = recalculateAthleteSnapshot(snapshot, contest, '2026-08-09T07:05:00.000Z');
  assert.equal(after.raceState.resolved?.currentSectionType, 'transition');
  assert.equal(after.raceState.resolved?.estimatedDistanceKm, 42);
  assert.equal(after.raceState.resolved?.etaNextSplit, null);
  assert.equal(after.raceState.resolved?.predictionSource, 'NO_TRANSITION_ETA');
});

function automaticStatusFixture(options: {
  reads?: Record<string, any>;
  status?: string;
  statusSource?: string;
  strictFinalCutoff?: boolean;
} = {}) {
  const gunStart = '2026-08-09T06:00:00.000Z';
  const contest: any = {
    providerContestUuid: 'contest', raceType: 'swimathon', totalDistanceKm: 2, timezone: 'UTC',
    startConfiguration: {
      mode: 'GUN', gunStartTime: gunStart, dnsGraceMinutes: 60,
      timingReorderBufferMs: 0, strictFinalCutoff: options.strictFinalCutoff === true,
    },
    cutoffs: { swim: 4_500, overall: 4_500 },
    splits: [
      { key: 'swim_start', displayName: 'Start', legType: 'swim', order: 1, cumulativeDistanceKm: 0, distanceInLegKm: 0, isStart: true, required: true },
      { key: 'swim_finish', displayName: 'Swim Finish', legType: 'swim', order: 2, cumulativeDistanceKm: 2, distanceInLegKm: 2, isFinish: true, required: true },
    ],
    legs: [{ type: 'swim', distanceKm: 2, startSplitKey: 'swim_start', finishSplitKey: 'swim_finish', cutoffSeconds: 4_500 }],
    transitions: [], sections: [],
  };
  const at = (seconds: number) => new Date(Date.parse(gunStart) + seconds * 1_000).toISOString();
  const read = (key: string, seconds: number) => ({
    readId: key, status: 'official', elapsedSeconds: seconds, overallElapsedSeconds: seconds,
    timestamp: at(seconds), occurredAt: at(seconds),
  });
  const snapshot: any = {
    schemaVersion: 1, eventId: 'event', buildVersion: 'build', updatedAt: gunStart,
    contestUuid: 'contest', courseVersion: 1, timingVersion: 1, leaderboardVersion: 1,
    identity: { participantUuid: 'participant', providerParticipantUuid: 'provider', bib: '1001' },
    bergmanIdentity: {},
    raceState: { status: options.status ?? 'not_started', statusSource: options.statusSource ?? null },
    startTiming: { officialStartTime: gunStart, startTimeSource: 'GUN', startTimeLocked: false, startStatus: 'NOT_STARTED' },
    reads: { swim_start: null, swim_finish: null, ...options.reads },
    calculated: {}, splits: [], sections: [], splitRankings: {}, overallRanking: {}, location: null,
    versions: { course: 1, participant: 1, timing: 1, profile: 1, leaderboard: 1 },
  };
  return { contest, snapshot, at, read };
}

test('automatic DNS applies exactly at the configured grace deadline and records its evidence', () => {
  const fixture = automaticStatusFixture();
  const before = recalculateAthleteSnapshot(fixture.snapshot, fixture.contest, fixture.at(3_599));
  assert.equal(before.raceState.resolved?.status, 'NOT_STARTED');
  const atDeadline = recalculateAthleteSnapshot(fixture.snapshot, fixture.contest, fixture.at(3_600));
  assert.equal(atDeadline.raceState.status, 'dns');
  assert.equal(atDeadline.raceState.statusReason, 'START_WINDOW_EXPIRED');
  assert.equal(atDeadline.raceState.statusSource, 'AUTO_TIMING_RULE');
  assert.equal(atDeadline.raceState.statusResolvedAt, fixture.at(3_600));
  assert.equal(atDeadline.raceState.resolved?.positionSource, 'NO_POSITION');
});

test('accepted START evidence prevents DNS even when imported after the grace deadline', () => {
  const fixture = automaticStatusFixture();
  fixture.snapshot.reads.swim_start = fixture.read('start', 1_800);
  const result = recalculateAthleteSnapshot(fixture.snapshot, fixture.contest, fixture.at(3_700));
  assert.equal(result.raceState.resolved?.status, 'ON_COURSE');
});

test('accepted CHIP START clears stale DNS and uses the accepted mat passage as net-time zero', () => {
  const fixture = automaticStatusFixture({ status: 'dns', statusSource: 'MANUAL_OVERRIDE' });
  fixture.contest.startConfiguration.mode = 'CHIP';
  fixture.snapshot.startTiming = {
    ...fixture.snapshot.startTiming,
    officialStartTime: fixture.at(0),
    chipStartDetectionTime: '2026-08-09T03:00:06.000Z',
    startTimeSource: 'CHIP',
    startTimeLocked: true,
    startStatus: 'ON_COURSE',
  };
  fixture.snapshot.reads.swim_start = fixture.read('accepted-chip-start', 3_660);

  const result = recalculateAthleteSnapshot(
    fixture.snapshot,
    fixture.contest,
    fixture.at(3_700),
  );

  assert.equal(result.raceState.resolved?.status, 'ON_COURSE');
  assert.equal(result.raceState.status, 'swimming');
  assert.equal(result.startTiming?.officialStartTime, fixture.at(3_660));
  assert.equal(result.startTiming?.chipStartDetectionTime, fixture.at(3_660));
  assert.equal(result.reads.swim_start?.elapsedSeconds, 0);
});

test('automatic DNF uses the exact cumulative cutoff and official checkpoint timestamp', () => {
  const fixture = automaticStatusFixture();
  fixture.snapshot.reads.swim_start = fixture.read('start', 10);
  const before = recalculateAthleteSnapshot(fixture.snapshot, fixture.contest, fixture.at(4_499));
  assert.equal(before.raceState.resolved?.status, 'ON_COURSE');
  const atDeadline = recalculateAthleteSnapshot(fixture.snapshot, fixture.contest, fixture.at(4_500));
  assert.equal(atDeadline.raceState.resolved?.status, 'DNF');
  assert.equal(atDeadline.raceState.statusReason, 'SWIM_CUTOFF_EXCEEDED');
  assert.equal(atDeadline.raceState.failedCheckpoint, 'swim_finish');
  assert.equal(atDeadline.raceState.cutoffSeconds, 4_500);
  assert.equal(atDeadline.raceState.cutoffDeadline, fixture.at(4_500));
  assert.equal(atDeadline.raceState.elapsedAtResolution, 4_500);
});

test('a checkpoint imported late remains valid when its official timestamp met the cutoff', () => {
  const fixture = automaticStatusFixture({ strictFinalCutoff: true });
  fixture.snapshot.reads.swim_start = fixture.read('start', 10);
  fixture.snapshot.reads.swim_finish = fixture.read('finish', 4_499);
  const result = recalculateAthleteSnapshot(fixture.snapshot, fixture.contest, fixture.at(5_000));
  assert.equal(result.raceState.resolved?.status, 'FINISHED');
  assert.equal(result.raceState.resolved?.finalSplitAccepted, true);
});

test('strict final cutoff makes a late official finish DNF while manual status remains authoritative', () => {
  const strict = automaticStatusFixture({ strictFinalCutoff: true });
  strict.snapshot.reads.swim_start = strict.read('start', 10);
  strict.snapshot.reads.swim_finish = strict.read('finish', 4_501);
  const late = recalculateAthleteSnapshot(strict.snapshot, strict.contest, strict.at(5_000));
  assert.equal(late.raceState.resolved?.status, 'DNF');

  const manual = automaticStatusFixture({ status: 'disqualified', statusSource: 'MANUAL_OVERRIDE' });
  manual.snapshot.reads.swim_start = manual.read('start', 10);
  manual.snapshot.reads.swim_finish = manual.read('finish', 4_000);
  const result = recalculateAthleteSnapshot(manual.snapshot, manual.contest, manual.at(5_000));
  assert.equal(result.raceState.resolved?.status, 'DSQ');
  assert.equal(result.raceState.statusSource, 'MANUAL_OVERRIDE');
});
