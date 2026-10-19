import { beforeEach, describe, expect, it, vi } from 'vitest';
import { processFeibotAthleteTiming, type TimingEngineConfiguration } from '../packages/timing-core/src';
const state = vi.hoisted(() => ({ values: new Map<string, unknown>(), publish: vi.fn(), detail: vi.fn(), config: vi.fn() }));
vi.mock('@opennextjs/cloudflare', () => ({ getCloudflareContext: async () => ({ env: { RACEUPSHOT: {
  get: async (key: string) => state.values.get(key) ?? null,
  put: async (key: string, value: string) => { state.values.set(key, JSON.parse(value)); },
  delete: async (key: string) => { state.values.delete(key); },
} } }) }));
vi.mock('@/lib/platform-repository', () => ({ getAdminLiveParticipantDetail: state.detail }));
vi.mock('@/lib/live-tracking-hub-config', () => ({ getLiveTrackingHubConfig: state.config }));
vi.mock('@/lib/raceupshot-repository', () => ({ getEventBySlug: async () => ({ ticketDefinitions: [] }) }));
vi.mock('@/lib/canonical-live-tracking', () => ({
  getCanonicalParticipantIndex: async () => ({ rows: [{ participantUuid: 'athlete', sourceParticipantUid: 'athlete', providerContestUuid: 'provider-contest' }] }),
  publishIncrementalCanonicalParticipants: state.publish,
}));
vi.mock('@/lib/feibot-timing-processing', () => ({
  getAthleteTimingAudit: async (event: string, contest: string, participant: string) => state.values.get(`raceupshot:timing-engine:${event}:${contest}:${participant}:audit`),
  authoritativeFeibotTimingSequence: (config: { sequence: unknown }) => config.sequence,
  enforceConfiguredCutoffs: ({ audit }: { audit: unknown }) => audit,
}));
import { reviewTimingCorrections, saveTimingCorrection } from '@/lib/timing-corrections';

const prefix = 'raceupshot:timing-engine:provider:provider-contest:athlete';
const receivedAt = '2026-10-19T01:00:00.000Z';
const configuration: TimingEngineConfiguration = {
  eventUuid: 'provider', contestUuid: 'provider-contest', timingResultSource: 'FEIBOT_PROCESSED', resultTimeMode: 'CHIP',
  gunStartTimestamp: '2026-10-19T00:00:00.000Z', startWindowOpenTimestamp: '2026-10-19T00:00:00.000Z',
  startWindowCloseTimestamp: null, eventEndTimestamp: null, passageGapMs: 5000, readerDetectionTimeoutMs: {},
  sequence: [
    { timingPointKey: 'start', timingPointUuid: 'mat', name: 'Start', type: 'START', order: 0, readerUuids: ['reader'] },
    { timingPointKey: 'finish', timingPointUuid: 'mat', name: 'Finish', type: 'FINISH', order: 1, readerUuids: ['reader'] },
  ],
};
const results = configuration.sequence.map((split, i) => ({ timingPointKey: split.timingPointKey, timingPointUuid: 'mat', timingPointName: split.name,
  readerTimestamp: `2026-10-19T00:${i ? '20' : '00'}:00.000Z`, gunTimeMs: i * 1200000, chipTimeMs: i * 1200000, sectionTimeMs: i * 1200000 }));
const deletion = { action: 'DELETE' as const, splitId: 'finish', reason: 'Wrong crossing', providerReceivedAt: receivedAt };
describe('scoped correction storage', () => {
  beforeEach(() => {
    state.values.clear(); state.publish.mockReset(); state.publish.mockResolvedValue(true);
    state.detail.mockResolvedValue({ canonical: { buildVersion: 'v1' }, participant: { participantUid: 'athlete', bib: '1', splits: [] }, identity: { providerEventUuid: 'provider', providerParticipantUuid: 'athlete', contestUuid: 'public-contest' } });
    state.config.mockResolvedValue(configuration);
    state.values.set(`${prefix}:provider-review`, { eventId: 'event', receivedAt, configuration, processedResults: results });
    state.values.set(`${prefix}:audit`, processFeibotAthleteTiming({ configuration, rawReads: [], participantIdentity: { participantUuid: 'athlete', bib: '1', chipCode: '123' }, feibotProcessedResults: results }));
  });
  it('uses provider contest identity and retains evidence before publishing', async () => {
    const review = await saveTimingCorrection('event', 'athlete', 'admin@example.com', deletion);
    expect(review.officialSplits.map(row => row.timingPointKey)).toEqual(['start']);
    expect([...state.values.keys()].some(key => key.startsWith(`${prefix}:correction-evidence:`))).toBe(true);
    expect(review.corrections[0].authorizedBy).toBe('admin@example.com');
    expect(state.publish).toHaveBeenCalledWith(expect.objectContaining({ eventId: 'event', providerEventUuid: 'provider' }));
    expect((await reviewTimingCorrections('event', 'athlete')).providerSplits).toHaveLength(2);
  });
  it('rejects a provider review belonging to a different event', async () => {
    await expect(saveTimingCorrection('other-event', 'athlete', 'admin@example.com', deletion)).rejects.toThrow('Check Feibot');
    expect(state.publish).not.toHaveBeenCalled();
  });
  it('rejects stale provider review and invalid split IDs before any write', async () => {
    await expect(saveTimingCorrection('event', 'athlete', 'admin@example.com', { ...deletion, providerReceivedAt: 'old' })).rejects.toThrow('changed');
    await expect(saveTimingCorrection('event', 'athlete', 'admin@example.com', { ...deletion, splitId: 'another-course' })).rejects.toThrow('configured course');
    expect(state.values.size).toBe(2);
  });
  it('restores Feibot timing with an append-only restore decision', async () => {
    await saveTimingCorrection('event', 'athlete', 'admin@example.com', deletion);
    const restored = await saveTimingCorrection('event', 'athlete', 'admin@example.com', { ...deletion, action: 'RESTORE' });
    expect(restored.officialSplits).toHaveLength(2);
    expect(restored.corrections).toHaveLength(2);
    expect([...state.values.keys()].filter(key => key.startsWith(`${prefix}:override:`))).toHaveLength(2);
  });
});
