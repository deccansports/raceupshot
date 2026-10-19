import { expect, test } from 'vitest';
import { normalizeTimingReads, type RaceSplitConfig } from './raceSections';

const splits: RaceSplitConfig[] = [
  { key: 'swim_700', name: 'Swim 700 m', legId: 'swim', order: 1, providerTimingPointIds: ['MAT-1'], passNumber: 1 },
  { key: 'swim_finish', name: 'Swim Finish', legId: 'swim', order: 2, providerTimingPointIds: ['MAT-1'], passNumber: 2 },
];

test('does not reuse one ambiguous physical-mat read for every logical split', () => {
  const result = normalizeTimingReads(splits, [{ timingPointId: 'MAT-1', elapsedSeconds: 900, status: 'valid' }]);
  expect([...result.keys()]).toEqual([]);
});

test('maps shared physical-mat reads only with Feibot pass numbers', () => {
  const result = normalizeTimingReads(splits, [
    { timingPointId: 'MAT-1', passNumber: 1, elapsedSeconds: 900, status: 'valid' },
    { timingPointId: 'MAT-1', passNumber: 2, elapsedSeconds: 1800, status: 'valid' },
  ]);
  expect([...result.entries()].map(([key, read]) => [key, read.elapsedSeconds])).toEqual([
    ['swim_700', 900],
    ['swim_finish', 1800],
  ]);
});
