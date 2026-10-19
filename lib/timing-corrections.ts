import { getCloudflareContext } from '@opennextjs/cloudflare';
import { getAdminLiveParticipantDetail } from './platform-repository';
import { getLiveTrackingHubConfig } from './live-tracking-hub-config';
import { getEventBySlug } from './raceupshot-repository';
import { getAthleteTimingAudit, authoritativeFeibotTimingSequence, enforceConfiguredCutoffs } from './feibot-timing-processing';
import { getCanonicalParticipantIndex, publishIncrementalCanonicalParticipants } from './canonical-live-tracking';
import { processFeibotAthleteTiming, type ManualTimingOverride, type TimingEngineConfiguration, type FeibotProcessedTimingResult } from '@/packages/timing-core/src';

type ProviderReview = { eventId: string; receivedAt: string; configuration: TimingEngineConfiguration; processedResults: FeibotProcessedTimingResult[] };

async function context(eventId: string, participantId: string) {
  const detail = await getAdminLiveParticipantDetail(eventId, participantId, true);
  if (!detail?.canonical.buildVersion) throw new Error('Canonical athlete not found in this event.');
  const { env } = await getCloudflareContext({ async: true });
  const kv = env.RACEUPSHOT;
  const { providerEventUuid, providerParticipantUuid } = detail.identity;
  const index = await getCanonicalParticipantIndex(eventId);
  const indexed = index?.rows.find(row => row.sourceParticipantUid === detail.participant.participantUid || row.participantUuid === detail.participant.participantUid);
  const contestUuid = indexed?.providerContestUuid || detail.identity.contestUuid;
  if (!providerEventUuid || !contestUuid) throw new Error('Provider event/contest identity is unavailable.');
  const uid = indexed?.participantUuid || providerParticipantUuid || detail.participant.participantUid;
  const audit = await getAthleteTimingAudit(providerEventUuid, contestUuid, uid);
  if (!audit) throw new Error('Fetch Feibot results before correcting this athlete.');
  const prefix = `raceupshot:timing-engine:${[providerEventUuid, contestUuid, uid].map(value => encodeURIComponent(value.trim())).join(':')}`;
  const provider = await kv.get<ProviderReview>(`${prefix}:provider-review`, 'json');
  if (!provider || provider.eventId !== eventId) throw new Error('Check Feibot first to capture an unmodified provider record for this athlete.');
  return { detail, kv, audit, prefix, provider, uid };
}

export async function reviewTimingCorrections(eventId: string, participantId: string) {
  const { audit, provider, kv, prefix } = await context(eventId, participantId);
  const warning = await kv.get<string>(`${prefix}:correction-conflict`, 'json');
  return { receivedAt: provider.receivedAt, providerSplits: provider.processedResults, corrections: audit.manualOverrides, officialSplits: audit.officialResults, warning };
}

export async function saveTimingCorrection(eventId: string, participantId: string, actor: string, input: {
  splitId: string; action: 'EDIT' | 'DELETE' | 'RESTORE'; readerTimestamp?: string; reason: string; providerReceivedAt: string;
}) {
  const { detail, kv, audit, prefix, provider, uid } = await context(eventId, participantId);
  if (provider.receivedAt !== input.providerReceivedAt) throw new Error('Feibot data changed. Review the latest values before saving.');
  const [hubConfig, event] = await Promise.all([getLiveTrackingHubConfig(eventId), getEventBySlug(eventId, { includeUnpublished: true })]);
  if (!hubConfig) throw new Error('Timing configuration is unavailable.');
  const configuration = { ...provider.configuration, sequence: authoritativeFeibotTimingSequence(hubConfig, audit.contestUuid, { requireAssignedReaders: false }) };
  const point = configuration.sequence.find(point => point.timingPointKey === input.splitId);
  if (!point) throw new Error('Split is not part of this athlete’s configured course.');
  if (input.action === 'DELETE' && point.type === 'START') throw new Error('The race start cannot be deleted. Edit its crossing time instead.');
  if (input.action === 'RESTORE' && !provider.processedResults.some(split => split.timingPointKey === input.splitId)) throw new Error('Feibot has no reading for this split to restore.');
  const timestamp = input.action === 'EDIT' ? input.readerTimestamp : new Date().toISOString();
  if (!timestamp || !Number.isFinite(Date.parse(timestamp))) throw new Error('Enter a valid crossing date and time.');
  const correction: ManualTimingOverride = {
    overrideId: crypto.randomUUID(), participantUuid: uid, timingPointKey: input.splitId,
    action: input.action, readerTimestamp: timestamp, source: 'MANUAL', authorized: true,
    authorizedBy: actor, reason: input.reason, appliedAt: new Date().toISOString(),
  };
  const computed = processFeibotAthleteTiming({ configuration, rawReads: audit.rawReads,
    participantIdentity: { participantUuid: uid, bib: audit.bib, chipCode: audit.chipCode },
    feibotProcessedResults: provider.processedResults, manualOverrides: [...audit.manualOverrides, correction] });
  const next = enforceConfiguredCutoffs({ audit: computed, previousAudit: audit, configuration, hubConfig,
    now: correction.appliedAt, ticketDefinitions: event?.ticketDefinitions, waveStartTime: detail.identity.waveStartTime });
  // Append-only audit; deletion excludes a split from official calculation, not from evidence.
  await kv.put(`${prefix}:correction-evidence:${encodeURIComponent(correction.overrideId)}`, JSON.stringify({
    correction, previousOfficialResults: audit.officialResults, provider,
  }));
  await kv.put(`${prefix}:override:${encodeURIComponent(correction.overrideId)}`, JSON.stringify(correction));
  await kv.put(`${prefix}:audit`, JSON.stringify(next));
  await kv.put(`${prefix}:official`, JSON.stringify(next.officialResults));
  await kv.delete(`${prefix}:correction-conflict`);
  await publishIncrementalCanonicalParticipants({ eventId, providerEventUuid: audit.eventUuid,
    rows: [{ ...detail.participant, chipCode: audit.chipCode }], reason: 'split_updated' });
  return { receivedAt: provider.receivedAt, providerSplits: provider.processedResults, corrections: next.manualOverrides, officialSplits: next.officialResults, warning: null };
}
