import { expect, test } from 'vitest';
import { isLiveTimingAwaitingCutoffUpdate } from './cutoffTiming';

const start = Date.parse('2026-10-10T17:55:30.000Z');
const detail = {
  header: { status: 'live' },
  raceStartedAt: start,
  raceProgress: { legLabel: 'Run' },
  cutoffs: [{ label: 'Overall / Finish Cutoff', value: '05:00:00' }],
  timeline: [{ name: 'RUN START', elapsedTimeLabel: '01:40:07' }],
};

test('hides a running time after the configured cutoff until another official timing update', () => {
  expect(isLiveTimingAwaitingCutoffUpdate({ detail, nowMs: start + 6 * 60 * 60 * 1000 })).toBe(true);
});

test('does not hide an official clock before the cutoff or a terminal athlete', () => {
  expect(isLiveTimingAwaitingCutoffUpdate({ detail, nowMs: start + 4 * 60 * 60 * 1000 })).toBe(false);
  expect(isLiveTimingAwaitingCutoffUpdate({ detail: { ...detail, header: { status: 'finished' } }, nowMs: start + 6 * 60 * 60 * 1000 })).toBe(false);
});
