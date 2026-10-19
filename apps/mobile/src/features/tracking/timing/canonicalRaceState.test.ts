import { expect, test } from 'vitest';
import { resolveCanonicalRaceState } from './canonicalRaceState';

const finishEvidence = {
    sections: [{ status: 'completed', rows: [{ name: 'FINISH', status: 'accepted', isRaceFinish: true }] }],
    timeline: [{ name: 'FINISH', state: 'completed' }],
  };

test('does not turn a DNF into a finisher from a stale finish split', () => {
  const state = resolveCanonicalRaceState({ ...finishEvidence, terminalStatus: 'DNF' });
  expect(state).toMatchObject({ status: 'STOPPED', hasConfirmedFinish: false, showPrediction: false });
});
test('stops predictions while a cutoff awaits timing reconciliation', () => {
  const state = resolveCanonicalRaceState({ ...finishEvidence, terminalStatus: 'No Finish Time — Pending Verification' });
  expect(state).toMatchObject({ status: 'STOPPED', hasConfirmedFinish: false, showPrediction: false });
});
test('confirms finish when the mat read and finish status agree', () => {
  const state = resolveCanonicalRaceState({ ...finishEvidence, resultStatus: 'FINISHED' });
  expect(state).toMatchObject({ status: 'FINISHED', hasConfirmedFinish: true, showPrediction: false });
});
test('keeps a started athlete live while awaiting the next mat read', () => {
  const state = resolveCanonicalRaceState({ timeline: [{ name: 'RUN START', state: 'completed' }, { name: 'FINISH', state: 'upcoming' }] });
  expect(state).toMatchObject({ status: 'IN_PROGRESS', hasConfirmedFinish: false, showPrediction: true });
});
test('does not finish because only the currently visible swim leg is completed', () => {
  const state = resolveCanonicalRaceState({
    resultStatus: 'STARTED',
    sections: [{ status: 'completed', rows: [{ name: 'SWIM FINISH', key: 'swim_finish', status: 'official' }] }],
  });
  expect(state).toMatchObject({ status: 'IN_PROGRESS', hasConfirmedFinish: false, showPrediction: true });
});
