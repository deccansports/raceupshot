import { validFinishTime, type ResultLeg } from './finisher-result-template';

export type TransactionalChannel = 'EMAIL' | 'WHATSAPP';
export type TransactionalKind = 'FINISHER' | 'REGISTRATION';
export type NotificationState = 'PENDING' | 'CLAIMED' | 'PROVIDER_ACCEPTED' | 'FAILED' | 'UNCONFIRMED' | 'SKIPPED';
export type NotificationActor = 'SYSTEM' | 'ADMIN';

export interface NotificationAttempt {
  id: string;
  at: string;
  actor: NotificationActor;
  channel: TransactionalChannel;
  recipient: string;
  state: Exclude<NotificationState, 'PENDING'>;
  providerStatus?: string;
  providerResponse?: string;
  reason?: string;
}

export interface NotificationLedgerRecord {
  identity: string;
  kind: TransactionalKind;
  channel: TransactionalChannel;
  eventId: string;
  contestId: string;
  participantId: string;
  status: NotificationState;
  recipient: string;
  claimToken?: string;
  attempts: NotificationAttempt[];
  updatedAt: string;
  skipReason?: string;
}

export function notificationIdentity(eventId: string, contestId: string, participantId: string, kind: TransactionalKind): string | null {
  const values = [eventId, contestId, participantId].map((item) => item.trim());
  return values.every(Boolean) ? JSON.stringify([kind, ...values]) : null;
}

export function isFinalizedRegistration(status: string, row: Record<string, unknown>): boolean {
  const normalized = status.trim().toUpperCase().replace(/[\s-]+/g, '_');
  if (!['CONFIRMED', 'PAID', 'COMPLETED', 'FINALIZED'].includes(normalized)) return false;
  if (row.cancelledAt || row.refundedAt || row.deletedAt || row.voidedAt) return false;
  return true;
}

export function finisherEligibility(row: Record<string, unknown>, isTriathlon: boolean): { eligible: boolean; reason: string } {
  const status = String(row.status ?? row.raceStatus ?? '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  if (['DNS', 'DNF', 'DNQ', 'DSQ', 'DQ', 'OTL', 'VOID', 'VOIDED', 'PROVISIONAL'].includes(status) || row.voidedAt || row.isVoided === true || row.provisional === true) return { eligible: false, reason: 'RESULT_NOT_OFFICIAL' };
  if (status !== 'FINISHED' || row.published === false) return { eligible: false, reason: 'RESULT_NOT_FINISHED' };
  const seconds = Number(row.overallTime ?? row.chipTime ?? 0);
  const finish = String(row.finishTime ?? '');
  if (!(Number.isFinite(seconds) && seconds > 0) && !validFinishTime(finish)) return { eligible: false, reason: 'MISSING_FINISH_TIME' };
  const splits = Array.isArray(row.splits) ? row.splits as Array<Record<string, unknown>> : [];
  const terminal = splits.some((split) => /^(race\s*)?finish$/i.test(String(split.name ?? split.label ?? ''))
    && (Number(split.time ?? split.officialTimeMs ?? 0) > 0 || Boolean(split.timestamp || split.readerTimestamp)));
  const finishTimestamp = String(row.finishTimeOfDay ?? '').trim();
  const physicalTimestamp = Boolean(finishTimestamp && (/^\d{1,2}:\d{2}:\d{2}(?:\.\d+)?$/.test(finishTimestamp) || !Number.isNaN(Date.parse(finishTimestamp))));
  if (!terminal && !physicalTimestamp) return { eligible: false, reason: 'MISSING_CONFIRMED_FINISH_EVIDENCE' };
  if (isTriathlon) {
    const legs = Array.isArray(row.legTimes) ? row.legTimes as ResultLeg[] : [];
    const byName = new Map(legs.map((leg) => [leg.name.trim().toUpperCase(), Number(leg.time)]));
    if (['SWIM', 'T1', 'BIKE', 'T2', 'RUN'].some((name) => !(Number.isFinite(byName.get(name)) && (byName.get(name) ?? 0) > 0))) return { eligible: false, reason: 'INCOMPLETE_TRIATHLON_TIMING' };
  }
  return { eligible: true, reason: '' };
}

export function canClaimNotification(status: NotificationState | undefined, input: { actor: NotificationActor; retryFailed: boolean; forceResend: boolean; confirmed: boolean }): boolean {
  if (!status || status === 'PENDING' || status === 'SKIPPED') return true;
  if (status === 'CLAIMED' || status === 'UNCONFIRMED') return false;
  if (input.actor === 'SYSTEM') return false;
  if (status === 'PROVIDER_ACCEPTED') return input.forceResend && input.confirmed;
  return status === 'FAILED' && (input.retryFailed || input.forceResend) && input.confirmed;
}

export function appendAttempt(record: NotificationLedgerRecord | null, attempt: NotificationAttempt, token: string | undefined): NotificationLedgerRecord {
  if (!record) throw new Error('Notification claim is missing.');
  if (record.claimToken !== token || record.status !== 'CLAIMED') throw new Error('Notification claim token mismatch.');
  return { ...record, status: attempt.state, claimToken: undefined, attempts: [...record.attempts, attempt], updatedAt: attempt.at };
}
