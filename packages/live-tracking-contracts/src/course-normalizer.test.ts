import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeCanonicalCourse } from './course-normalizer';

test('saved race-flow labels and KM markers override invalid provider distances', () => {
  const course = normalizeCanonicalCourse({
    eventId: 'event-1',
    buildVersion: 'build-1',
    source: 'feibot_cloud',
    timezone: 'Asia/Kolkata',
    contestMappings: [{
      providerContestUuid: 'contest-new',
      bergmanTicketId: 'ticket-1',
      displayName: 'Test 1',
      raceType: 'swimathon',
      configuredRaceDistanceKm: 1.9,
      splitMappings: [
        { canonicalCode: 'swim_start', providerSplitId: 'start', order: 1, displayName: 'START', cumulativeDistanceKm: 0 },
        { canonicalCode: 'swim_checkpoint_1', providerSplitId: 'checkpoint', order: 2, displayName: 'Swim 1 km', cumulativeDistanceKm: 1 },
        { canonicalCode: 'swim_finish', providerSplitId: 'finish', order: 3, displayName: 'FINISH', cumulativeDistanceKm: 1.9 },
      ],
    }],
    timingRules: {
      legs: [{ leg_uuid: 'leg-swim', contest_uuid: 'contest-new', leg_name: 'SWIM', order: 1 }],
      splits: [
        { split_uuid: 'start', contest_uuid: 'contest-new', leg_uuid: 'leg-swim', split_name: 'Provider Start', order: 2, distanceFromStartKm: 5, timing_point_uuid: 'tp-start' },
        { split_uuid: 'checkpoint', contest_uuid: 'contest-new', leg_uuid: 'leg-swim', split_name: 'Provider Checkpoint', order: 3, distanceFromStartKm: 1, timing_point_uuid: 'tp-checkpoint' },
        { split_uuid: 'finish', contest_uuid: 'contest-new', leg_uuid: 'leg-swim', split_name: 'Provider Finish', order: 1, distanceFromStartKm: 0, timing_point_uuid: 'tp-finish' },
      ],
    },
  });

  const contest = course.contests[0];
  assert.equal(course.validation.valid, true);
  assert.deepEqual(contest.splits.map((split) => split.displayName), ['START', 'Swim 1 km', 'FINISH']);
  assert.deepEqual(contest.splits.map((split) => split.cumulativeDistanceKm), [0, 1, 1.9]);
  assert.equal(contest.totalDistanceKm, 1.9);
});

test('shared timing points resolve by provider split and configured triathlon distances', () => {
  const splitMappings = [
    ['swim_start', '4uscdYgh', 'shared-start-finish', 1, 'Start'],
    ['swim_finish', '4RSDJfEL', 'shared-transition-1', 2, 'Swim Finish'],
    ['bike_start', '3BoGq8U9', 'shared-transition-1', 3, 'Bike Start'],
    ['bike_finish', '3c3jrd9F', 'shared-transition-2', 4, 'Bike Finish'],
    ['run_start', '4R4DBz6h', 'shared-transition-2', 5, 'Run Start'],
    ['run_finish', '4DBMkLxV', 'shared-start-finish', 6, 'Run Finish'],
  ].map(([canonicalCode, providerSplitId, providerTimingPointId, order, displayName]) => ({
    canonicalCode: String(canonicalCode), providerSplitId: String(providerSplitId),
    providerTimingPointId: String(providerTimingPointId), order: Number(order), displayName: String(displayName),
    readSelectionRule: 'first' as const,
  }));
  const course = normalizeCanonicalCourse({
    eventId: 'event-triathlon', buildVersion: 'build-triathlon', source: 'feibot_cloud', timezone: 'Asia/Kolkata',
    contestMappings: [{
      providerContestUuid: 'contest-1', bergmanTicketId: 'ticket-1', raceType: 'triathlon',
      configuredRaceDistanceKm: 52, legDistancesKm: { swim: 2, bike: 40, run: 10 }, splitMappings,
    }],
    timingRules: { splits: splitMappings.map((mapping, index) => ({
      split_uuid: mapping.providerSplitId, contest_uuid: 'contest-1', split_name: mapping.providerSplitId,
      split_index: index + 1, timing_point_uuid: mapping.providerTimingPointId, DistanceFromStart: index * 1000,
    })) },
  });
  const contest = course.contests[0];
  assert.equal(course.validation.valid, true);
  assert.deepEqual(contest.splits.map((split) => split.key), ['swim_start', 'swim_finish', 'bike_start', 'bike_finish', 'run_start', 'run_finish']);
  assert.deepEqual(contest.splits.map((split) => split.displayName), ['Start', 'Swim Finish', 'Bike Start', 'Bike Finish', 'Run Start', 'Run Finish']);
  assert.deepEqual(contest.splits.map((split) => split.cumulativeDistanceKm), [0, 2, 2, 42, 42, 52]);
  assert.deepEqual(contest.splits.map((split) => split.isRaceStart), [true, false, false, false, false, false]);
  assert.deepEqual(contest.splits.map((split) => split.isLegStart), [true, false, true, false, true, false]);
  assert.deepEqual(contest.splits.map((split) => split.isRaceFinish), [false, false, false, false, false, true]);
  assert.deepEqual(contest.splits.map((split) => split.isLegFinish), [false, true, false, true, false, true]);
  assert.deepEqual(contest.splits.map((split) => split.isStart), [true, false, false, false, false, false]);
  assert.deepEqual(contest.splits.map((split) => split.isFinish), [false, false, false, false, false, true]);
  assert.deepEqual(contest.sections.map((section) => section.key), ['swim', 't1', 'bike', 't2', 'run']);
});

test('triathlon checkpoints use leg distance while cumulative race distance remains monotonic', () => {
  const definitions = [
    ['swim_start', 'Start', 0], ['swim_1_km', 'Swim 1 km', 1], ['swim_finish', 'Swim Finish', 2],
    ['bike_start', 'Bike Start', 0], ['bike_10_km', 'Bike 10 km', 10], ['bike_20_km', 'Bike 20 km', 20],
    ['bike_30_km', 'Bike 30 km', 30], ['bike_finish', 'Bike 40 km / Finish', 40],
    ['run_start', 'Run Start', 0], ['run_2_5_km', 'Run 2.5 km', 2.5], ['run_5_km', 'Run 5 km', 5],
    ['run_7_5_km', 'Run 7.5 km', 7.5], ['run_finish', 'Run 10 km / Finish', 10],
  ] as const;
  const splitMappings = definitions.map(([canonicalCode, displayName, distanceInLegKm], index) => ({
    canonicalCode,
    displayName,
    distanceInLegKm,
    providerSplitId: `split-${index + 1}`,
    providerTimingPointId: `tp-${index + 1}`,
    order: index + 1,
    readSelectionRule: 'first' as const,
  }));
  const course = normalizeCanonicalCourse({
    eventId: 'event-checkpoints', buildVersion: 'build-checkpoints', source: 'feibot_cloud', timezone: 'Asia/Kolkata',
    contestMappings: [{
      providerContestUuid: 'contest-checkpoints', bergmanTicketId: 'ticket-checkpoints', raceType: 'triathlon',
      configuredRaceDistanceKm: 52, legDistancesKm: { swim: 2, bike: 40, run: 10 }, splitMappings,
    }],
    timingRules: { splits: splitMappings.map((mapping, index) => ({
      split_uuid: mapping.providerSplitId,
      contest_uuid: 'contest-checkpoints',
      split_name: mapping.displayName,
      split_index: index + 1,
      timing_point_uuid: mapping.providerTimingPointId,
      // Deliberately invalid provider distance: mapping must remain authoritative.
      DistanceFromStart: index * 1000,
      DistanceFromStartUnit: 'kilometers',
    })) },
  });

  const contest = course.contests[0];
  assert.equal(course.validation.valid, true);
  assert.deepEqual(contest.splits.map((split) => split.distanceInLegKm), [
    0, 1, 2, 0, 10, 20, 30, 40, 0, 2.5, 5, 7.5, 10,
  ]);
  assert.deepEqual(contest.splits.map((split) => split.cumulativeDistanceKm), [
    0, 1, 2, 2, 12, 22, 32, 42, 42, 44.5, 47, 49.5, 52,
  ]);
});

test('canonical contest aliases consume splits and legs from legacy provider contest UUIDs', () => {
  const course = normalizeCanonicalCourse({
    eventId: 'event-alias',
    buildVersion: 'build-alias',
    source: 'feibot_cloud',
    contestMappings: [{
      providerContestUuid: 'contest-canonical',
      legacyContestIds: ['contest-provider-current'],
      bergmanTicketId: 'ticket-alias',
      raceType: 'swimathon',
      configuredRaceDistanceKm: 1,
      splitMappings: [
        { canonicalCode: 'swim_start', providerSplitId: 'start', order: 1, cumulativeDistanceKm: 0 },
        { canonicalCode: 'swim_finish', providerSplitId: 'finish', order: 2, cumulativeDistanceKm: 1 },
      ],
    }],
    timingRules: {
      legs: [{ leg_uuid: 'leg-swim', contest_uuid: 'contest-provider-current', leg_name: 'SWIM', order: 1 }],
      splits: [
        { split_uuid: 'start', contest_uuid: 'contest-provider-current', leg_uuid: 'leg-swim', split_name: 'Start', order: 1 },
        { split_uuid: 'finish', contest_uuid: 'contest-provider-current', leg_uuid: 'leg-swim', split_name: 'Finish', order: 2 },
      ],
    },
  });

  assert.equal(course.contests[0]?.providerContestUuid, 'contest-canonical');
  assert.deepEqual(course.contests[0]?.splits.map((split) => split.providerSplitId), ['start', 'finish']);
  assert.equal(course.validation.valid, true);
});

test('keeps provider names immutable while applying display overrides and preserves timing point ID plus UUID', () => {
  const course = normalizeCanonicalCourse({
    eventId: 'event-provider-fields', buildVersion: 'build-provider-fields', source: 'feibot_cloud',
    contestMappings: [{
      providerContestUuid: 'contest-provider', bergmanTicketId: 'ticket-provider', raceType: 'swimathon', configuredRaceDistanceKm: 1,
      splitMappings: [
        { canonicalCode: 'swim_start', providerSplitId: 'provider-start', displayName: 'Start Arch', cumulativeDistanceKm: 0, order: 1 },
        { canonicalCode: 'swim_finish', providerSplitId: 'provider-finish', displayName: 'Finish Arch', cumulativeDistanceKm: 1, order: 2 },
      ],
    }],
    timingRules: { splits: [
      { split_uuid: 'provider-start', contest_uuid: 'contest-provider', split_name: 'Feibot Swim Start', timing_point_uuid: '5fD3OAat', timing_point_id: 1, order: 1 },
      { split_uuid: 'provider-finish', contest_uuid: 'contest-provider', split_name: 'Feibot Swim Finish', timing_point_uuid: '5fD3OAat', timing_point_id: 1, order: 2 },
    ] },
  });

  assert.deepEqual(course.contests[0].splits.map((split) => split.displayName), ['Start Arch', 'Finish Arch']);
  assert.deepEqual(course.contests[0].splits.map((split) => split.providerName), ['Feibot Swim Start', 'Feibot Swim Finish']);
  assert.deepEqual(course.contests[0].splits.map((split) => split.providerTimingPointUuid), ['5fD3OAat', '5fD3OAat']);
  assert.deepEqual(course.contests[0].splits.map((split) => split.providerTimingPointNumericId), ['1', '1']);
  assert.equal(course.validation.valid, true);
  assert.ok(course.validation.warnings.some((warning) => warning.code === 'shared_timing_point_unresolved_nonfatal'));
});

test('canonical split identity includes Bergman event, Feibot event, contest, and split UUID', () => {
  const course = normalizeCanonicalCourse({
    eventId: 'bergman-event',
    buildVersion: 'build-1',
    source: 'feibot_cloud',
    timingRules: {
      legs: [{ UUID: 'leg-1', ContestUUID: 'contest-1', Name: 'Run', Order: 1 }],
      splits: [{ UUID: 'split-1', ContestUUID: 'contest-1', LegUUID: 'leg-1', Name: 'Start', Order: 1, TimingPointUUID: 'point-1' }],
    },
    contestMappings: [{
      providerEventUuid: 'provider-event',
      providerContestUuid: 'contest-1',
      bergmanTicketId: 'ticket-1',
      raceType: 'running',
      configuredRaceDistanceKm: 10,
    }],
  });

  const split = course.contests[0].splits[0];
  assert.equal(course.contests[0].providerEventUuid, 'provider-event');
  assert.equal(split.bergmanEventId, 'bergman-event');
  assert.equal(split.providerEventUuid, 'provider-event');
  assert.equal(split.contestUuid, 'contest-1');
  assert.equal(split.splitUuid, 'split-1');
  assert.equal(split.canonicalIdentityKey, 'bergman-event:provider-event:contest-1:split-1');
});
