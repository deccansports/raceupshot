import assert from 'node:assert/strict';
import test from 'node:test';

import { validateCanonicalCourse } from './course-validation.ts';

test('canonical course rejects duplicate timing-point/pass ownership within a contest', () => {
  const bundle: any = {
    eventId: '4cEm8JPYbpupoFRMDLc1',
    buildVersion: 'candidate-build',
    updatedAt: '2026-08-18T07:00:00.000Z',
    contests: [{
      providerEventUuid: '6QTff6CR',
      providerContestUuid: '6UWIfyI9',
      bergmanTicketId: 'intGnHibtkore6F7gMQC',
      raceType: 'custom',
      configuredRaceDistanceKm: 0,
      legs: [],
      transitions: [],
      splits: [
        {
          key: 'swim_finish', providerSplitId: '73VTBWS4', providerTimingPointId: '5fD3OAat',
          displayName: 'Swim Finish', order: 2, distanceInLegKm: 1.5, cumulativeDistanceKm: 1.5,
          readSelectionRule: 'pass_number', passNumber: 2, rankingEnabled: true, required: true,
        },
        {
          key: 'run_finish', providerSplitId: 'dqnjps7i', providerTimingPointId: '5fD3OAat',
          displayName: 'Run Finish', order: 8, distanceInLegKm: 10, cumulativeDistanceKm: 51.5,
          readSelectionRule: 'pass_number', passNumber: 2, rankingEnabled: true, required: true,
        },
      ],
    }],
  };

  const validation = validateCanonicalCourse(bundle);
  const collision = validation.errors.find((error) => error.code === 'timing_point_pass_collision');
  assert.equal(validation.valid, false);
  assert.ok(collision);
  assert.equal(collision?.contestUuid, '6UWIfyI9');
  assert.match(collision?.message || '', /6QTff6CR/);
  assert.match(collision?.message || '', /5fD3OAat:2/);
});

test('canonical course allows the same physical timing-point/pass in different contests', () => {
  const split = (key: string, providerSplitId: string) => ({
    key,
    providerSplitId,
    providerTimingPointId: '5fD3OAat',
    displayName: 'Swim Start',
    order: 1,
    distanceInLegKm: 0,
    cumulativeDistanceKm: 0,
    readSelectionRule: 'pass_number',
    passNumber: 1,
    rankingEnabled: true,
    required: true,
  });
  const contest = (providerContestUuid: string, providerSplitId: string) => ({
    providerEventUuid: '6QTff6CR',
    providerContestUuid,
    bergmanTicketId: `ticket-${providerContestUuid}`,
    raceType: 'custom',
    configuredRaceDistanceKm: 0,
    legs: [],
    transitions: [],
    splits: [split(`${providerContestUuid}-start`, providerSplitId)],
  });
  const validation = validateCanonicalCourse({
    eventId: '4cEm8JPYbpupoFRMDLc1',
    buildVersion: 'candidate-build',
    updatedAt: '2026-08-18T07:00:00.000Z',
    contests: [
      contest('6mDRe5lS', '180bGihn'),
      contest('6UWIfyI9', '4EcEtvUo'),
    ],
  } as any);

  assert.equal(validation.errors.some((error) => error.code === 'timing_point_pass_collision'), false);
});

test('canonical course rejects the Olympic Swim Finish and Run Finish pass-2 ambiguity', () => {
  const validation = validateCanonicalCourse({
    eventId: '4cEm8JPYbpupoFRMDLc1',
    buildVersion: 'candidate-build',
    updatedAt: '2026-08-18T07:00:00.000Z',
    contests: [{
      providerEventUuid: '6QTff6CR',
      providerContestUuid: '6mDRe5lS',
      bergmanTicketId: 'QVmkC9logIQ8VD3LVL3K',
      raceType: 'custom',
      configuredRaceDistanceKm: 0,
      legs: [],
      transitions: [],
      splits: [
        {
          key: 'swim_finish', providerSplitId: '42qeADKJ', providerTimingPointId: '5fD3OAat',
          displayName: 'Swim Finish', order: 2, distanceInLegKm: 1.5, cumulativeDistanceKm: 1.5,
          readSelectionRule: 'pass_number', passNumber: 2, rankingEnabled: true, required: true,
        },
        {
          key: 'run_finish', providerSplitId: 'cJ0nJBDD', providerTimingPointId: '5fD3OAat',
          displayName: 'Run Finish', order: 8, distanceInLegKm: 10, cumulativeDistanceKm: 51.5,
          readSelectionRule: 'pass_number', passNumber: 2, rankingEnabled: true, required: true,
        },
      ],
    }],
  } as any);

  assert.equal(validation.errors.filter((error) => error.code === 'timing_point_pass_collision').length, 1);
});
