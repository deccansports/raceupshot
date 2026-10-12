import { beforeEach, describe, expect, it, vi } from 'vitest';
import { canClaimNotification, type NotificationLedgerRecord } from '../lib/transactional-notification-contract';

const state = vi.hoisted(() => ({
  values: new Map<string, unknown>(),
  ledger: new Map<string, NotificationLedgerRecord>(),
  contacts: {} as Record<string, { email: string; mobile: string; audit: Array<Record<string, string>> }>,
  whatsapp: vi.fn(),
  email: vi.fn(),
}));

vi.mock('@opennextjs/cloudflare', () => ({ getCloudflareContext: async () => ({ env: { RACEUPSHOT: {
  get: async (key: string) => state.values.get(key) ?? null,
} } }) }));
vi.mock('../lib/raceupshot-repository', () => ({ getEventBySlug: async () => ({ id: 'event', name: 'Race Upshot Test', slug: 'test', hasResults: true, tickets: [], ticketDefinitions: [] }) }));
vi.mock('../lib/live-tracking-hub-config', () => ({ getLiveTrackingHubConfig: async () => ({ notifications: {
  enabled: true, finishersEnabled: true, emailEnabled: true, emailTemplateId: 'event-template',
  whatsappEnabled: true, whatsappCampaignName: 'event-campaign', campaignName: 'Finisher',
} }) }));
vi.mock('../lib/participant-chip-assignments', () => ({ getAdminParticipantRoster: async () => ({ rows: [] }) }));
vi.mock('../lib/transactional-notification-gate', () => ({ assertTransactionalSendsEnabled: async () => {} }));
vi.mock('../lib/aisensy-whatsapp', () => ({ normalizeAiSensyPhone: (value: string) => value, sendAiSensyWhatsApp: state.whatsapp }));
vi.mock('../lib/bergtecno-email', () => ({ sendBergtecnoEmail: state.email }));
vi.mock('../lib/transactional-notification-ledger', () => ({
  readNotificationLedger: async () => [...state.ledger.values()],
  readNotificationContacts: async () => state.contacts,
  recordNotificationSkip: async () => undefined,
  claimNotification: async (input: { identity: string; channel: string; actor: 'ADMIN' | 'SYSTEM'; retryFailed?: boolean; forceResend?: boolean; confirmed?: boolean; eventId: string; contestId: string; participantId: string; kind: 'FINISHER'; recipient: string }) => {
    const key = input.channel + ':' + input.identity;
    const previous = state.ledger.get(key);
    if (!canClaimNotification(previous?.status, { actor: input.actor, retryFailed: Boolean(input.retryFailed), forceResend: Boolean(input.forceResend), confirmed: Boolean(input.confirmed) })) return { token: null, reason: 'CLAIM_BLOCKED' };
    state.ledger.set(key, { identity: input.identity, channel: input.channel as 'EMAIL' | 'WHATSAPP', kind: input.kind, eventId: input.eventId, contestId: input.contestId, participantId: input.participantId, recipient: input.recipient, status: 'CLAIMED', claimToken: 'claim', attempts: previous?.attempts ?? [], updatedAt: new Date().toISOString() });
    return { token: 'claim', reason: '' };
  },
  completeNotification: async (input: { identity: string; channel: string; state: 'PROVIDER_ACCEPTED' | 'FAILED' | 'UNCONFIRMED'; recipient: string; actor: 'ADMIN' | 'SYSTEM'; reason?: string }) => {
    const key = input.channel + ':' + input.identity;
    const previous = state.ledger.get(key)!;
    const next = { ...previous, status: input.state, claimToken: undefined, attempts: [...previous.attempts, { id: String(previous.attempts.length + 1), at: new Date().toISOString(), state: input.state, recipient: input.recipient, actor: input.actor, channel: previous.channel, reason: input.reason }], updatedAt: new Date().toISOString() } as NotificationLedgerRecord;
    state.ledger.set(key, next);
    return next;
  },
  correctNotificationContact: async () => ({ email: '', mobile: '', audit: [] }),
}));

import { getFinisherNotificationSummary, sendFinisherNotificationBatch } from '../lib/result-emails';

const row = { name: 'Asha', category: 'Run', bib: '001', status: 'FINISHED', mobile: '+919999999999', email: 'asha@example.com', overallTime: 3600, finishTimeOfDay: '09:00:00', legTimes: [{ name: 'Run', time: 3600 }] };
function publish(id: string, result: Record<string, unknown> = row) {
  const ids = state.values.get('raceupshot:event:event:results:index') as string[] | undefined ?? [];
  state.values.set('raceupshot:event:event:results:index', [...ids, id]);
  state.values.set('raceupshot:event:event:result:' + id, { notificationSourceId: id, ...result });
}

describe('published finisher notifications', () => {
  beforeEach(() => {
    state.values.clear(); state.ledger.clear(); state.contacts = {};
    vi.clearAllMocks(); state.whatsapp.mockResolvedValue({ accepted: true }); state.email.mockResolvedValue({ sent: true });
  });
  it('does not create a recipient from canonical or registration rosters', async () => {
    expect((await getFinisherNotificationSummary('event')).total).toBe(0);
    await sendFinisherNotificationBatch('event', 'Overall', ['WHATSAPP'], false, { trigger: 'automatic' });
    expect(state.whatsapp).not.toHaveBeenCalled();
  });
  it('requires manual identity review when an imported row had only a generated BIB-based ID', async () => {
    publish('Run-001', { ...row, notificationSourceId: '' });
    await sendFinisherNotificationBatch('event', 'Overall', ['EMAIL'], false, { trigger: 'automatic' });
    expect(state.email).not.toHaveBeenCalled();
    expect((await getFinisherNotificationSummary('event')).finishers?.[0].emailStatus).toBe('REVIEW_REQUIRED');
  });
  it('does not auto-send when two rows in one contest claim the same source ID', async () => {
    publish('result-a', { ...row, notificationSourceId: 'shared' });
    publish('result-b', { ...row, name: 'Ben', notificationSourceId: 'shared' });
    await sendFinisherNotificationBatch('event', 'Overall', ['EMAIL'], false, { trigger: 'automatic' });
    expect(state.email).not.toHaveBeenCalled();
    expect((await getFinisherNotificationSummary('event')).finishers?.map((item) => item.emailStatus)).toEqual(['REVIEW_REQUIRED', 'REVIEW_REQUIRED']);
  });
  it('sends published finishers once per channel and labels provider acceptance', async () => {
    publish('result-a');
    await sendFinisherNotificationBatch('event', 'Overall', ['WHATSAPP'], false, { trigger: 'automatic' });
    await sendFinisherNotificationBatch('event', 'Overall', ['WHATSAPP'], false, { trigger: 'automatic' });
    expect(state.whatsapp).toHaveBeenCalledTimes(1);
    expect(state.whatsapp).toHaveBeenCalledWith(expect.objectContaining({ campaignName: 'event-campaign', parameters: ['Asha', 'Run', 'Race Upshot Test', 'Run', '001', '01:00:00', 'Run: 01:00:00'] }));
    expect((await getFinisherNotificationSummary('event')).finishers?.[0].whatsappStatus).toBe('ACCEPTED');
  });
  it('separates duplicated BIBs by exact result ID and rejects BIB-only targeting', async () => {
    publish('result-a'); publish('result-b', { ...row, name: 'Ben', mobile: '+918888888888' });
    await expect(sendFinisherNotificationBatch('event', 'Overall', ['WHATSAPP'], false, { bib: '001', trigger: 'manual', confirmed: true })).rejects.toThrow('BIB alone');
    await sendFinisherNotificationBatch('event', 'Overall', ['WHATSAPP'], false, { resultId: 'result-b', trigger: 'manual', confirmed: true });
    expect(state.whatsapp).toHaveBeenCalledTimes(1);
    expect(state.whatsapp).toHaveBeenCalledWith(expect.objectContaining({ userName: 'Ben' }));
  });
  it.each(['DNF', 'DNS', 'DSQ', 'PROVISIONAL', 'STARTED'])('skips %s even with a finish time', async (status) => {
    publish('result-a', { ...row, status });
    await sendFinisherNotificationBatch('event', 'Overall', ['WHATSAPP'], false, { trigger: 'automatic' });
    expect(state.whatsapp).not.toHaveBeenCalled();
  });
  it('preserves accepted ledger after a stale or voided result', async () => {
    publish('result-a');
    await sendFinisherNotificationBatch('event', 'Overall', ['EMAIL'], false, { trigger: 'automatic' });
    state.values.set('raceupshot:event:event:result:result-a', { ...row, notificationSourceId: 'result-a', status: 'VOIDED' });
    const summary = await getFinisherNotificationSummary('event');
    expect(summary.finishers?.[0].emailStatus).toBe('ACCEPTED');
    await sendFinisherNotificationBatch('event', 'Overall', ['EMAIL'], false, { trigger: 'automatic' });
    expect(state.email).toHaveBeenCalledTimes(1);
  });
  it('does not automatically retry provider failure or ambiguous timeout', async () => {
    publish('result-a');
    state.whatsapp.mockResolvedValueOnce({ accepted: false, error: 'failed' });
    await sendFinisherNotificationBatch('event', 'Overall', ['WHATSAPP'], false, { trigger: 'automatic' });
    await sendFinisherNotificationBatch('event', 'Overall', ['WHATSAPP'], false, { trigger: 'automatic' });
    expect(state.whatsapp).toHaveBeenCalledTimes(1);
    state.ledger.clear(); state.whatsapp.mockResolvedValueOnce({ accepted: false, ambiguous: true, error: 'timeout' });
    await sendFinisherNotificationBatch('event', 'Overall', ['WHATSAPP'], false, { trigger: 'automatic' });
    await sendFinisherNotificationBatch('event', 'Overall', ['WHATSAPP'], false, { trigger: 'automatic' });
    expect(state.whatsapp).toHaveBeenCalledTimes(2);
    expect((await getFinisherNotificationSummary('event')).finishers?.[0].whatsappStatus).toBe('UNCONFIRMED');
  });
  it('requires a confirmed manual resend after provider acceptance', async () => {
    publish('result-a');
    await sendFinisherNotificationBatch('event', 'Overall', ['EMAIL'], false, { trigger: 'automatic' });
    await expect(sendFinisherNotificationBatch('event', 'Overall', ['EMAIL'], true, { resultId: 'result-a', trigger: 'manual', forceResend: true })).rejects.toThrow('Confirm');
    await sendFinisherNotificationBatch('event', 'Overall', ['EMAIL'], true, { resultId: 'result-a', trigger: 'manual', forceResend: true, confirmed: true });
    expect(state.email).toHaveBeenCalledTimes(2);
  });
  it('keeps an earlier accepted delivery visible after a failed confirmed resend', async () => {
    publish('result-a');
    await sendFinisherNotificationBatch('event', 'Overall', ['EMAIL'], false, { trigger: 'automatic' });
    state.email.mockResolvedValueOnce({ sent: false, error: 'provider unavailable' });
    await sendFinisherNotificationBatch('event', 'Overall', ['EMAIL'], true, { resultId: 'result-a', trigger: 'manual', forceResend: true, confirmed: true });
    expect((await getFinisherNotificationSummary('event')).finishers?.[0].emailStatus).toBe('ACCEPTED');
  });
});
