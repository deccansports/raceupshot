import { describe, expect, it } from 'vitest';
import { appendAttempt, canClaimNotification, finisherEligibility, isFinalizedRegistration, notificationIdentity, type NotificationLedgerRecord } from '../lib/transactional-notification-contract';

const finisher = { status: 'FINISHED', overallTime: 7200, finishTimeOfDay: '09:00:00', legTimes: [
  { name: 'Swim', time: 1200 }, { name: 'T1', time: 120 }, { name: 'Bike', time: 3000 }, { name: 'T2', time: 80 }, { name: 'Run', time: 1800 },
] };

describe('transactional notification contract', () => {
  it('separates duplicated BIBs by event, contest and exact result identity', () => {
    expect(notificationIdentity('event', 'olympic', 'result-1', 'FINISHER')).not.toBe(notificationIdentity('event', 'olympic', 'result-2', 'FINISHER'));
    expect(notificationIdentity('event', 'olympic', 'result-1', 'FINISHER')).not.toBe(notificationIdentity('event', 'sprint', 'result-1', 'FINISHER'));
    expect(notificationIdentity('event', 'olympic', 'result-1', 'FINISHER')).not.toBe(notificationIdentity('other', 'olympic', 'result-1', 'FINISHER'));
    expect(notificationIdentity('event', 'olympic', 'result-1', 'FINISHER')).not.toBe(notificationIdentity('event', 'olympic', 'result-1', 'REGISTRATION'));
  });

  it('requires official finish evidence and complete triathlon fields', () => {
    expect(finisherEligibility(finisher, true).eligible).toBe(true);
    expect(finisherEligibility({ ...finisher, finishTimeOfDay: '', splits: [] }, true).reason).toBe('MISSING_CONFIRMED_FINISH_EVIDENCE');
    expect(finisherEligibility({ ...finisher, legTimes: finisher.legTimes.filter((leg) => leg.name !== 'T1') }, true).reason).toBe('INCOMPLETE_TRIATHLON_TIMING');
    expect(finisherEligibility({ ...finisher, legTimes: [] }, false).eligible).toBe(true);
  });

  it.each(['DNS', 'DNF', 'DSQ', 'VOIDED', 'PROVISIONAL', 'STARTED'])('rejects %s with an elapsed time', (status) => {
    expect(finisherEligibility({ ...finisher, status }, true).eligible).toBe(false);
  });

  it('blocks automatic duplicates and ambiguous timeouts; permits only confirmed admin resend', () => {
    const system = { actor: 'SYSTEM' as const, retryFailed: false, forceResend: false, confirmed: false };
    expect(canClaimNotification(undefined, system)).toBe(true);
    for (const state of ['CLAIMED', 'PROVIDER_ACCEPTED', 'FAILED', 'UNCONFIRMED'] as const) expect(canClaimNotification(state, system)).toBe(false);
    expect(canClaimNotification('UNCONFIRMED', { ...system, actor: 'ADMIN', retryFailed: true, forceResend: true, confirmed: true })).toBe(false);
    expect(canClaimNotification('PROVIDER_ACCEPTED', { ...system, actor: 'ADMIN', forceResend: true, confirmed: true })).toBe(true);
    expect(canClaimNotification('FAILED', { ...system, actor: 'ADMIN', retryFailed: true, confirmed: true })).toBe(true);
  });

  it('keeps earlier accepted attempts immutable after a later attempt', () => {
    const record: NotificationLedgerRecord = { identity: 'id', kind: 'FINISHER', channel: 'EMAIL', eventId: 'event', contestId: 'contest', participantId: 'result', status: 'CLAIMED', recipient: 'a@example.com', claimToken: 'token', updatedAt: '2026-10-12T00:00:00Z', attempts: [{ id: 'old', at: '2026-10-11T00:00:00Z', actor: 'SYSTEM', channel: 'EMAIL', recipient: 'a@example.com', state: 'PROVIDER_ACCEPTED' }] };
    const next = appendAttempt(record, { id: 'new', at: '2026-10-12T00:00:00Z', actor: 'ADMIN', channel: 'EMAIL', recipient: 'b@example.com', state: 'FAILED', reason: 'provider unavailable' }, 'token');
    expect(record.attempts).toHaveLength(1);
    expect(next.attempts.map((attempt) => attempt.state)).toEqual(['PROVIDER_ACCEPTED', 'FAILED']);
    expect(() => appendAttempt(record, next.attempts[1], 'wrong')).toThrow('token mismatch');
  });

  it('sends registration only on a non-voided final status', () => {
    expect(isFinalizedRegistration('paid', { registrationStatus: 'paid' })).toBe(true);
    expect(isFinalizedRegistration('paid', { refundedAt: '2026-10-12' })).toBe(false);
    expect(isFinalizedRegistration('pending', {})).toBe(false);
  });
});
