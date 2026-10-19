import { describe, expect, it, vi } from 'vitest';
import { processFeibotAthleteTiming, type TimingEngineConfiguration, type ManualTimingOverride } from '../packages/timing-core/src';
import { configuredCourseDistance } from '../lib/course-distance';
vi.mock('@opennextjs/cloudflare', () => ({ getCloudflareContext: vi.fn() }));
import { applyAuthoritativeTimingProjection, mergeCanonicalParticipantState } from '../lib/canonical-live-tracking';
import type { LiveParticipant } from '../packages/contracts/src';

const configuration: TimingEngineConfiguration = {
  eventUuid: 'event', contestUuid: 'contest', timingResultSource: 'FEIBOT_PROCESSED', resultTimeMode: 'CHIP',
  gunStartTimestamp: '2026-10-19T00:00:00.000Z', startWindowOpenTimestamp: '2026-10-19T00:00:00.000Z',
  startWindowCloseTimestamp: null, eventEndTimestamp: null, passageGapMs: 5000, readerDetectionTimeoutMs: {},
  sequence: ['start', 'run1', 'finish'].map((id, i) => ({ timingPointKey: id, timingPointUuid: 'shared', name: id, type: i === 0 ? 'START' : i === 2 ? 'FINISH' : 'SPLIT', order: i, readerUuids: ['reader'] })),
};
const provider = configuration.sequence.map((point, index) => ({ timingPointKey: point.timingPointKey,
  timingPointUuid: point.timingPointUuid, timingPointName: point.name,
  readerTimestamp: `2026-10-19T00:${String(index * 10).padStart(2, '0')}:00.000Z`, gunTimeMs: index * 600000, chipTimeMs: index * 600000, sectionTimeMs: index ? 600000 : 0 }));
function correction(action: 'EDIT' | 'DELETE' | 'RESTORE', split = 'run1', index = 0): ManualTimingOverride {
  return { action, overrideId: `correction-${index}`, participantUuid: 'athlete', timingPointKey: split,
    readerTimestamp: '2026-10-19T00:12:00.000Z', source: 'MANUAL', authorized: true,
    authorizedBy: 'admin@example.com', reason: 'Timing review', appliedAt: `2026-10-19T01:00:0${index}.000Z` };
}
function process(manualOverrides: ManualTimingOverride[]) {
  return processFeibotAthleteTiming({ configuration, rawReads: [], participantIdentity: { participantUuid: 'athlete', bib: '1', chipCode: '123' }, feibotProcessedResults: provider, manualOverrides });
}
describe('audited split corrections', () => {
  it('recalculates section times after an edit', () => {
    const audit = process([correction('EDIT')]);
    expect(audit.officialResults[1].chipTimeMs).toBe(720000);
    expect(audit.officialResults[2].sectionTimeMs).toBe(480000);
  });
  it('excludes a mandatory split and blocks completion without deleting evidence', () => {
    const audit = process([correction('DELETE')]);
    expect(audit.officialResults.map(row => row.timingPointKey)).toEqual(['start']);
    expect(audit.state).not.toBe('FINISHED');
    expect(provider).toHaveLength(3);
    expect(audit.manualOverrides).toHaveLength(1);
  });
  it('restores the provider result only after explicit restore', () => {
    expect(process([correction('DELETE'), correction('RESTORE', 'run1', 1)]).officialResults).toHaveLength(3);
    expect(process([correction('DELETE')]).officialResults).toHaveLength(1);
  });
  it('does not allow deletion of the race start', () => {
    expect(() => process([correction('DELETE', 'start')])).toThrow('race start cannot be deleted');
  });
  it('rejects out-of-sequence edits', () => {
    expect(() => process([{ ...correction('EDIT'), readerTimestamp: '2026-10-19T00:25:00.000Z' }])).toThrow('sequence');
  });
  it('does not resurrect a removed finish during canonical merging', () => {
    const base: LiveParticipant = { eventId: 'event', participantUid: 'athlete', bib: '1', displayName: 'Athlete', initials: 'A', contestName: 'Race', raceStatus: 'FINISHED', visibility: 'PUBLIC', splits: [] };
    const corrected = { ...base, raceStatus: 'STARTED' as const, timingCorrectionAt: '2026-10-19T01:00:00Z' };
    expect(mergeCanonicalParticipantState(base, corrected, base).raceStatus).toBe('STARTED');
  });
  it('replaces an old finish split with the latest Feibot audit projection', () => {
    const finish = { splitId: 'finish', name: 'Run Finish', splitTime: '01:00:00', timestamp: '2026-10-19T01:00:00Z' };
    const start = { splitId: 'start', name: 'Start', splitTime: '00:00:00', timestamp: '2026-10-19T00:00:00Z' };
    const base: LiveParticipant = { eventId: 'event', participantUid: 'athlete', bib: '1', displayName: 'Athlete', initials: 'A', contestName: 'Race', raceStatus: 'FINISHED', visibility: 'PUBLIC', splits: [start, finish] };
    const audit: LiveParticipant = { ...base, raceStatus: 'STARTED', splits: [start], latestTimingPoint: 'Start' };
    const projected = applyAuthoritativeTimingProjection(base, audit, { ...audit, currentLeg: 'RUNNING' });
    expect(projected.raceStatus).toBe('STARTED');
    expect(projected.currentLeg).toBe('RUNNING');
    expect(projected.splits.map((row) => row.splitId)).toEqual(['start']);
  });
});
describe('course total distance', () => {
  it('uses the designated final split rather than adding three copies of the course total', () => {
    expect(configuredCourseDistance([{ order: 9, isFinalRaceSplit: true, distanceKm: 51.5 }], [{ distanceKm: 51.5 }, { distanceKm: 51.5 }, { distanceKm: 51.5 }])).toBe(51.5);
  });
  it('does not use an intermediate split as the course finish', () => {
    expect(configuredCourseDistance([{ order: 1, distanceKm: 10 }], [{ distanceKm: 21 }])).toBe(21);
  });
});
