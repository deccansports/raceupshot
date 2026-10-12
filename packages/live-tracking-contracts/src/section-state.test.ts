import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveCurrentRaceSection, type AcceptedSplitBoundary } from './section-state.ts';

const sections = [
  { key: 'swim', sectionType: 'leg' as const, order: 1, startSplitKey: 'start', finishSplitKey: 'swim_finish' },
  { key: 't1', sectionType: 'transition' as const, order: 2, startSplitKey: 'swim_finish', finishSplitKey: 'bike_start' },
  { key: 'bike', sectionType: 'leg' as const, order: 3, startSplitKey: 'bike_start', finishSplitKey: 'bike_finish' },
  { key: 't2', sectionType: 'transition' as const, order: 4, startSplitKey: 'bike_finish', finishSplitKey: 'run_start' },
  { key: 'run', sectionType: 'leg' as const, order: 5, startSplitKey: 'run_start', finishSplitKey: 'run_finish' },
];
const at = (seconds: number): AcceptedSplitBoundary => ({
  accepted: true,
  elapsedSeconds: seconds,
  timestamp: new Date(Date.parse('2026-08-09T06:05:00.000Z') + seconds * 1000).toISOString(),
});

const state = (reads: Record<string, AcceptedSplitBoundary>) =>
  resolveCurrentRaceSection(sections, reads, '2026-08-09T07:05:00.000Z');

test('section order resolves exactly one active leg or transition', () => {
  assert.equal(state({ start: at(0) }).currentSectionKey, 'swim');
  assert.equal(state({ start: at(0), swim_finish: at(1800) }).currentSectionKey, 't1');
  assert.equal(state({ start: at(0), swim_finish: at(1800), bike_start: at(2100) }).currentSectionKey, 'bike');
  const t2 = state({ start: at(0), swim_finish: at(1800), bike_start: at(2100), bike_finish: at(3000) });
  assert.equal(t2.currentSectionKey, 't2');
  assert.equal(t2.currentSectionType, 'transition');
  assert.equal(t2.sections.find((section) => section.key === 'run')?.status, 'not_started');
  assert.equal(state({ start: at(0), swim_finish: at(1800), bike_start: at(2100), bike_finish: at(3000), run_start: at(3300) }).currentSectionKey, 'run');
  const finished = state({ start: at(0), swim_finish: at(1800), bike_start: at(2100), bike_finish: at(3000), run_start: at(3300), run_finish: at(4200) });
  assert.equal(finished.currentSectionKey, null);
  assert.equal(finished.currentSectionStatus, 'finished');
});

test('active transition clock starts at the accepted previous-leg finish', () => {
  const resolved = state({ start: at(0), swim_finish: at(1800), bike_start: at(2100), bike_finish: at(3000) });
  assert.equal(resolved.activeSince, at(3000).timestamp);
  assert.equal(resolved.elapsedSeconds, 600);
});
