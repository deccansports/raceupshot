import type { AthleteModalResponse } from '@/core/types';
import { buildCanonicalRaceFlow } from './canonicalRaceFlow';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Canonical race-flow contract failed: ${message}`);
}

const split = (key: string, displayName: string, legType: string, order: number, km: number) => ({ key, displayName, legType, order, cumulativeDistanceKm: km });
const accepted = (splitKey: string, elapsedSeconds: number, extra: Record<string, unknown> = {}) => ({
  splitKey,
  elapsedSeconds,
  status: 'VALID',
  readAt: new Date(Date.UTC(2026, 7, 8, 10, 0, elapsedSeconds)).toISOString(),
  ...extra,
});

export function runCanonicalRaceFlowContract(): true {
  const definitions = [
    split('swim-start', 'Swim Start', 'SWIM', 1, 0), split('swim-finish', 'Swim Finish', 'SWIM', 2, 2),
    split('bike-start', 'Bike Start', 'BIKE', 3, 2), split('bike-29', 'Bike 29.9', 'BIKE', 4, 29.9), split('bike-38', 'Bike 38.9', 'BIKE', 5, 38.9), split('bike-finish', 'Bike Finish', 'BIKE', 6, 82),
    split('run-start', 'Run Start', 'RUN', 7, 82), split('run-5', 'Run 5 KM', 'RUN', 8, 87), split('run-10', 'Run 10 KM', 'RUN', 9, 92), split('run-finish', 'Run Finish', 'RUN', 10, 102),
  ];
  const legs = [
    { key: 'SWIM', legType: 'SWIM', order: 1 },
    { key: 'BIKE', legType: 'BIKE', order: 3 },
    { key: 'RUN', legType: 'RUN', order: 5 },
  ];
  const transitions = [
    { key: 'T1', order: 2, startSplitKey: 'swim-finish', finishSplitKey: 'bike-start' },
    { key: 'T2', order: 4, startSplitKey: 'bike-finish', finishSplitKey: 'run-start' },
  ];
  const sections = [{ key: 'SWIM', order: 1 }, { key: 'T1', order: 2 }, { key: 'BIKE', order: 3 }, { key: 'T2', order: 4 }, { key: 'RUN', order: 5 }];
  const response = {
    success: true, eventId: 'event-1', activeVersion: 'v1', courseVersion: 'course-1',
    athlete: { participantUuid: 'p1', providerContestUuid: 'contest-1', status: 'LIVE', summary: { t1Seconds: 60 }, splits: [
      accepted('swim-finish', 3600, { sectionSeconds: 3600 }),
      accepted('bike-start', 3660),
      accepted('bike-29', 5400, { ranking: { overallRank: 2 } }),
      accepted('bike-finish', 9000),
      accepted('run-start', 9060),
    ] },
    contestContext: { contest: {
    providerContestUuid: 'contest-1', splits: definitions,
      legs,
      transitions,
    sections,
    } },
  } as unknown as AthleteModalResponse;
  const timing = buildCanonicalRaceFlow(response);
  assert(timing, 'valid contest must build');
  assert(timing.sections.map((row) => row.shortLabel).join(',') === 'SW,T1,BK,T2,RN', 'section order');
  assert(timing.sections.every((section) => section.rows.every((row) => row.name !== 'TRANSITION')), 'no synthetic transition rows');
  const bike = timing.sections.find((section) => section.shortLabel === 'BK');
  assert(bike?.rows.map((row) => row.name).join(',') === 'Bike Start,Bike 29.9,Bike 38.9,Bike Finish', 'canonical split order');
  assert(bike.rows[1].cumulativeDistanceKm === 29.9 && bike.rows[2].cumulativeDistanceKm === 38.9, 'API KM order');
  assert(bike.rows[1].rank === '#2', 'exact split-key timing join');
  const swim = timing.sections.find((section) => section.shortLabel === 'SW');
  assert(swim?.rows[1].cumulativeDistanceKm === bike.rows[0].cumulativeDistanceKm, 'equal-KM boundaries are preserved');
  assert(timing.sections.find((section) => section.shortLabel === 'T1')?.durationSeconds === 60, 'T1 accepted boundary duration');
  assert(timing.sections.find((section) => section.shortLabel === 'T2')?.durationSeconds === 60, 'T2 boundary fallback');
  assert(!timing.sections.some((section) => section.title === 'Race Timing'), 'no extra Race Timing section');

  const cumulativeSummaryRegression = {
    ...response,
    athlete: {
      ...response.athlete,
      status: 'FINISHED',
      // These are deliberately cumulative checkpoint values from the legacy
      // summary and must not become individual leg durations.
      summary: { swimSeconds: 995, t1Seconds: 1484, bikeSeconds: 2459, t2Seconds: 2668, runSeconds: 3303, overallSeconds: 3303 },
      splits: [
        accepted('swim-start', 151),
        accepted('swim-finish', 995),
        accepted('bike-start', 1484),
        accepted('bike-29', 1900),
        accepted('bike-38', 2250),
        accepted('bike-finish', 2459),
        accepted('run-start', 2668),
        accepted('run-5', 2850),
        accepted('run-10', 3100),
        accepted('run-finish', 3303),
      ],
    },
  } as unknown as AthleteModalResponse;
  const regressionFlow = buildCanonicalRaceFlow(cumulativeSummaryRegression);
  assert(regressionFlow?.sections.find((section) => section.shortLabel === 'SW')?.durationSeconds === 844, 'Swim is finish minus start');
  assert(regressionFlow?.sections.find((section) => section.shortLabel === 'T1')?.durationSeconds === 489, 'T1 is Bike Start minus Swim Finish');
  assert(regressionFlow?.sections.find((section) => section.shortLabel === 'BK')?.durationSeconds === 975, 'Bike is Bike Finish minus Bike Start');
  assert(regressionFlow?.sections.find((section) => section.shortLabel === 'T2')?.durationSeconds === 209, 'T2 is Run Start minus Bike Finish');
  assert(regressionFlow?.sections.find((section) => section.shortLabel === 'RN')?.durationSeconds === 635, 'Run is Run Finish minus Run Start');
  assert(regressionFlow?.overallTimeSeconds === 3303, 'Total remains continuous race elapsed');
  const regressionBike = regressionFlow?.sections.find((section) => section.shortLabel === 'BK');
  assert(regressionBike?.rows[0].metric == null, 'Bike Start has no speed at zero leg distance/time');
  assert(regressionBike?.averageMetric === '295.4 km/h', 'Bike average uses bike distance divided by Bike Finish minus Bike Start');

  const missingFinish = { ...response, athlete: { ...response.athlete, summary: {}, splits: [accepted('swim-finish', 100)] } } as AthleteModalResponse;
  const pendingT1 = buildCanonicalRaceFlow(missingFinish)?.sections.find((section) => section.shortLabel === 'T1');
  assert(pendingT1?.status === 'in_progress' && pendingT1.durationSeconds == null, 'missing transition finish boundary');

  const mismatch = { ...response, athlete: { ...response.athlete, providerContestUuid: 'other-contest' } } as AthleteModalResponse;
  assert(buildCanonicalRaceFlow(mismatch) === undefined, 'contest mismatch rejection');
  const negative = { ...response, athlete: { ...response.athlete, summary: {}, splits: [accepted('swim-finish', 100), accepted('bike-start', 90)] } } as AthleteModalResponse;
  assert(buildCanonicalRaceFlow(negative)?.sections.find((section) => section.shortLabel === 'T1')?.durationSeconds == null, 'negative transition rejection');

  const sparseProviderContext = {
    ...response,
    contestContext: {
      contest: { providerContestUuid: 'contest-1' },
      splits: [definitions[4]],
      legs: [{ key: 'BIKE', legType: 'BIKE', order: 3 }],
      transitions: [],
    },
    timingConfiguration: {
      raceFlowByContest: {
        'contest-1': {
          splits: definitions,
          legs,
          transitions,
          sections,
        },
      },
    },
  } as unknown as AthleteModalResponse;
  const restored = buildCanonicalRaceFlow(sparseProviderContext);
  assert(restored?.sections.map((section) => section.shortLabel).join(',') === 'SW,T1,BK,T2,RN', 'saved Race Flow replaces sparse provider context');
  assert(restored.sections.reduce((count, section) => count + section.rows.length, 0) === definitions.length, 'all saved split rows render');

  const testOneDefinitions = definitions
    .filter((row) => ['swim-start', 'swim-finish', 'bike-start', 'bike-finish', 'run-start', 'run-finish'].includes(row.key))
    .map((row) => row.key === 'swim-start' ? { ...row, displayName: 'Start' } : row);
  const markerHeavyResponse = {
    ...response,
    contestContext: {
      contest: { providerContestUuid: 'contest-1' },
      splits: definitions,
      legs,
      transitions,
      sections,
    },
    timingConfiguration: {
      raceFlowByContest: {
        'contest-1': { splits: testOneDefinitions, legs, transitions, sections },
      },
    },
  } as unknown as AthleteModalResponse;
  const markerSafeFlow = buildCanonicalRaceFlow(markerHeavyResponse);
  assert(
    markerSafeFlow?.sections.flatMap((section) => section.rows).map((row) => row.name).join(',')
      === 'Start,Swim Finish,Bike Start,Bike Finish,Run Start,Run Finish',
    'provider and GPX marker rows never expand the saved Test 1 Race Flow',
  );

  const providerUuidDefinitions = [
    split('swim_start', '4uscdYgh', 'SWIM', 1, 0),
    split('swim_finish', '4RSDJfEL', 'SWIM', 2, 2),
    split('bike_start', '3BoGq8U9', 'BIKE', 3, 2),
    split('bike_finish', '3c3jrd9F', 'BIKE', 4, 42),
    split('run_start', '4R4DBz6h', 'RUN', 5, 42),
    split('run_finish', '4DBMkLxV', 'RUN', 6, 52),
  ].map((row) => ({ ...row, providerSplitId: row.displayName }));
  const uuidResponse = {
    ...response,
    athlete: { ...response.athlete, splits: [] },
    contestContext: { contest: { providerContestUuid: 'contest-1', splits: providerUuidDefinitions, legs, transitions, sections } },
  } as unknown as AthleteModalResponse;
  const uuidFlow = buildCanonicalRaceFlow(uuidResponse);
  assert(uuidFlow?.sections.flatMap((section) => section.rows).map((row) => row.name).join(',') === 'Start,Swim Finish,Bike Start,Bike Finish,Run Start,Run Finish', 'provider UUIDs are never spectator labels');
  assert(uuidFlow.sections.flatMap((section) => section.rows).map((row) => row.cumulativeDistanceKm).join(',') === '0,2,2,42,42,52', 'Bergman cumulative distances');

  const corruptedProviderSplits = [
    { splitKey: 'run_start', providerSplitId: '4uscdYgh', displayName: 'Start', legType: 'run', order: 1, cumulativeDistanceKm: 0 },
    { splitKey: 'run_start', providerSplitId: '3BoGq8U9', displayName: 'Bike Start', legType: 'run', order: 2, cumulativeDistanceKm: 0 },
    { splitKey: 'run_start', providerSplitId: '4R4DBz6h', displayName: 'Run Start', legType: 'run', order: 3, cumulativeDistanceKm: 0 },
    { splitKey: 'run_finish', providerSplitId: '4RSDJfEL', displayName: 'Swim Finish', legType: 'run', order: 4, cumulativeDistanceKm: 52 },
    { splitKey: 'run_finish', providerSplitId: '3c3jrd9F', displayName: 'Bike Finish', legType: 'run', order: 5, cumulativeDistanceKm: 52 },
    { splitKey: 'run_finish', providerSplitId: '4DBMkLxV', displayName: 'Run Finish', legType: 'run', order: 6, cumulativeDistanceKm: 52 },
  ];
  const repairedResponse = {
    ...response,
    athlete: { ...response.athlete, splits: corruptedProviderSplits },
    ticketDefinition: {
      ticketCategory: 'Triathlon',
      courseMaps: { swimDistance: 2, bikeDistance: 40, runDistance: 10 },
    },
    contestContext: {
      contest: { providerContestUuid: 'contest-1', splits: corruptedProviderSplits },
      splits: corruptedProviderSplits,
      legs: [{ key: 'run', legType: 'RUN', order: 1 }],
      transitions: [],
      sections: [{ key: 'RUN', type: 'RUN', order: 1 }],
    },
  } as unknown as AthleteModalResponse;
  const repairedFlow = buildCanonicalRaceFlow(repairedResponse);
  assert(repairedFlow?.sections.map((section) => section.shortLabel).join(',') === 'SW,T1,BK,T2,RN', 'malformed single RUN leg is repaired from the Bergman triathlon ticket');
  assert(repairedFlow.sections.flatMap((section) => section.rows).map((row) => row.name).join(',') === 'Start,Swim Finish,Bike Start,Bike Finish,Run Start,Run Finish', 'malformed provider keys retain human boundary names');
  assert(repairedFlow.sections.flatMap((section) => section.rows).map((row) => row.cumulativeDistanceKm).join(',') === '0,2,2,42,42,52', 'provider 3000/4000/5000 distances are replaced by ticket distances');
  return true;
}
