import { expect, it } from 'vitest';
import { mergeTimingRefresh } from '../apps/volunteer-mobile/src/manualTimingRefresh';
const row = (id: string, canReset?: boolean) => ({ id, bib: id, athleteName: id, capturedAt: '2026-10-19T00:00:00Z', status: 'RECORDED', canReset });
it('preserves latest permission when a legacy response omits it', () => {
  expect(mergeTimingRefresh([row('new', true), row('old', false)], [row('new'), row('old')]).map(r => r.canReset)).toEqual([true, false]);
});
it('keeps a confirmed stamp missing from a lagging listing and locks the old stamp', () => {
  expect(mergeTimingRefresh([row('new', true), row('old', false)], [row('old', true)]).map(r => [r.id, r.canReset])).toEqual([['new', true], ['old', false]]);
});
it('respects explicit denial and does not reopen old stamps', () => {
  expect(mergeTimingRefresh([row('new', true)], [row('new', false)])[0].canReset).toBe(false);
  expect(mergeTimingRefresh([row('old', false)], [row('old')])[0].canReset).toBe(false);
});
it('accepts a newer server stamp when the local stamp is present', () => {
  expect(mergeTimingRefresh([row('old', true)], [row('new', true), row('old', false)]).map(r => r.canReset)).toEqual([true, false]);
});
