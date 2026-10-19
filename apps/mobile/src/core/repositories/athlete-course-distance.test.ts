import { describe, expect, it, vi } from 'vitest';
vi.mock('@/core/services/api', () => ({ api: {}, liveApi: {} }));
vi.mock('@/core/utils', () => ({ getCountryDisplayName: (v: unknown) => String(v ?? ''), getInitials: () => 'A' }));
import { adaptPlatformParticipantResponse } from './athlete.repository';
describe('current sport and transitions', () => {
  const legs = [
    { id: 'swim', type: 'SWIM', order: 0 }, { id: 't1', type: 'TRANSITION', order: 1 },
    { id: 'bike', type: 'BIKE', order: 2 }, { id: 't2', type: 'TRANSITION', order: 3 },
    { id: 'run', type: 'RUN', order: 4 },
  ];
  const splits = [
    { id: 'swim-start', legId: 'swim', order: 0, distanceKm: 0 },
    { id: 'swim-half', legId: 'swim', order: 1, distanceKm: 0.75 },
    { id: 'swim-finish', legId: 'swim', order: 2, distanceKm: 1.5 },
    { id: 'bike-start', legId: 'bike', order: 3, distanceKm: 1.6 },
    { id: 'bike-finish', legId: 'bike', order: 4, distanceKm: 41.5 },
    { id: 'run-start', legId: 'run', order: 5, distanceKm: 41.6 },
    { id: 'finish', legId: 'run', order: 6, distanceKm: 51.5, isFinalRaceSplit: true },
  ];
  function at(id: string, raceStatus = 'STARTED', status = 'PROVISIONAL') {
    return (adaptPlatformParticipantResponse({ data: {
      participantUid: 'athlete', contestId: 'triathlon', raceStatus, currentLeg: 'SWIM',
      splits: [{ splitId: id, status, readerTimestamp: '2026-10-19T08:00:00Z', chipTimeMs: 600000 }],
      timingConfiguration: { legs, splits },
    } }) as { data: { athlete: { currentLegName: string }; participantLive: { currentLeg: string; estimatedDistanceKm: number; distanceCoveredKm: number; predictedPaceSecondsPerKm?: number } } }).data;
  }
  it('enters T1 after swim finish and freezes sport-distance prediction', () => {
    const result = at('swim-finish');
    expect(result.athlete.currentLegName).toBe('Transition (T1)');
    expect(result.participantLive.currentLeg).toBe('T1');
    expect(result.participantLive.predictedPaceSecondsPerKm).toBeUndefined();
    expect(result.participantLive.estimatedDistanceKm).toBe(1.5);
  });
  it('enters bike only when Bike Start is accepted, despite stale provider SWIM state', () => {
    expect(at('bike-start').participantLive.currentLeg).toBe('BIKE');
  });
  it('enters T2 after Bike Finish, then RUN after Run Start', () => {
    expect(at('bike-finish').participantLive.currentLeg).toBe('T2');
    expect(at('run-start').participantLive.currentLeg).toBe('RUN');
  });
  it('does not treat an intermediate swim checkpoint as a transition', () => {
    expect(at('swim-half').participantLive.currentLeg).toBe('SWIM');
  });
  it('does not infer a transition merely because a hidden finish was omitted', () => {
    const result = adaptPlatformParticipantResponse({ data: {
      participantUid: 'athlete', contestId: 'triathlon', raceStatus: 'STARTED',
      splits: [{ splitId: 'swim-half', status: 'PROVISIONAL', chipTimeMs: 600000 }],
      timingConfiguration: { legs, splits: splits.filter(split => split.id !== 'swim-finish') },
    } }) as { data: { participantLive: { currentLeg: string } } };
    expect(result.data.participantLive.currentLeg).toBe('SWIM');
  });
  it('stays in T1 when Bike Start is still pending', () => {
    const result = adaptPlatformParticipantResponse({ data: {
      participantUid: 'athlete', contestId: 'triathlon', raceStatus: 'STARTED',
      splits: [
        { splitId: 'swim-finish', status: 'PROVISIONAL', chipTimeMs: 600000 },
        { splitId: 'bike-start', status: 'PENDING' },
      ],
      timingConfiguration: { legs, splits },
    } }) as { data: { participantLive: { currentLeg: string } } };
    expect(result.data.participantLive.currentLeg).toBe('T1');
  });
  it('does not enter transition from a pending reading or a stopped/finished athlete', () => {
    expect(at('swim-finish', 'STARTED', 'PENDING').participantLive.currentLeg).toBe('SWIM');
    expect(at('swim-finish', 'DNF').participantLive.currentLeg).toBe('SWIM');
    expect(at('finish', 'FINISHED').participantLive.currentLeg).toBe('RUN');
  });
});
describe('canonical course distance', () => {
  it('uses 51.5 km at the final split instead of summing three erroneous 51.5 km legs', () => {
    const output = adaptPlatformParticipantResponse({ data: {
      participantUid: 'athlete', contestId: 'triathlon', displayName: 'Athlete', splits: [],
      timingConfiguration: {
        legs: [{ distanceKm: 51.5 }, { distanceKm: 51.5 }, { distanceKm: 51.5 }],
        splits: [{ id: 'finish', order: 9, distanceKm: 51.5, isFinalRaceSplit: true }],
      },
    } }) as { data: { participantLive: { totalDistanceKm: number } } };
    expect(output.data.participantLive.totalDistanceKm).toBe(51.5);
  });
  it('uses only the athlete’s contest, not another course’s finish', () => {
    const output = adaptPlatformParticipantResponse({ data: {
      participantUid: 'athlete', contestId: 'short', displayName: 'Athlete', splits: [],
      timingConfiguration: {
        legs: [{ distanceKm: 100 }],
        splits: [{ id: 'long-finish', order: 9, distanceKm: 100, isFinalRaceSplit: true }],
        splitsByContest: { short: [{ id: 'short-finish', order: 9, distanceKm: 10, isFinalRaceSplit: true }] },
      },
    } }) as { data: { participantLive: { totalDistanceKm: number } } };
    expect(output.data.participantLive.totalDistanceKm).toBe(10);
  });
});
