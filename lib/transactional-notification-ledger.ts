import { getCloudflareContext } from '@opennextjs/cloudflare';
import type { NotificationActor, NotificationLedgerRecord, NotificationState, TransactionalChannel, TransactionalKind } from './transactional-notification-contract';

function stub(env: CloudflareEnv, eventId: string) {
  if (!eventId.trim()) throw new Error('An event ID is required for notification history.');
  return env.CANONICAL_CHANGE_HUB.getByName(`result-notifications:${eventId}`);
}

async function requestLedger<T>(eventId: string, path: string, method: 'GET' | 'POST', body?: unknown): Promise<T> {
  const { env } = await getCloudflareContext({ async: true });
  const response = await stub(env, eventId).fetch(`https://notifications.internal/notification-ledger/${path}`, {
    method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || 'Notification ledger is unavailable. No message was sent.');
  return payload;
}

export async function readNotificationLedger(eventId: string): Promise<NotificationLedgerRecord[]> {
  const response = await requestLedger<{ records: NotificationLedgerRecord[] }>(eventId, 'records', 'GET');
  return response.records;
}

export async function readNotificationContacts(eventId: string): Promise<Record<string, { email: string; mobile: string; audit: Array<Record<string, string>> }>> {
  const response = await requestLedger<{ contacts: Record<string, { email: string; mobile: string; audit: Array<Record<string, string>> }> }>(eventId, 'contacts', 'GET');
  return response.contacts;
}

export async function claimNotification(input: {
  eventId: string; contestId: string; participantId: string; identity: string; kind: TransactionalKind;
  channel: TransactionalChannel; recipient: string; actor: NotificationActor;
  retryFailed?: boolean; forceResend?: boolean; confirmed?: boolean; legacyAccepted?: boolean;
}): Promise<{ token: string | null; reason: string }> {
  return requestLedger(input.eventId, 'claim', 'POST', input);
}

export async function completeNotification(input: {
  eventId: string; identity: string; channel: TransactionalChannel; token: string;
  state: Extract<NotificationState, 'PROVIDER_ACCEPTED' | 'FAILED' | 'UNCONFIRMED' | 'SKIPPED'>;
  actor: NotificationActor; recipient: string; providerStatus?: string; providerResponse?: string; reason?: string;
}): Promise<NotificationLedgerRecord> {
  const response = await requestLedger<{ record: NotificationLedgerRecord }>(input.eventId, 'complete', 'POST', input);
  return response.record;
}

export async function recordNotificationSkip(input: {
  eventId: string; contestId: string; participantId: string; identity: string; kind: TransactionalKind;
  channel: TransactionalChannel; recipient: string; actor: NotificationActor; reason: string;
}): Promise<NotificationLedgerRecord> {
  const response = await requestLedger<{ record: NotificationLedgerRecord }>(input.eventId, 'skip', 'POST', input);
  return response.record;
}

export async function correctNotificationContact(input: {
  eventId: string; contestId: string; participantId: string; identity: string;
  email: string; mobile: string; previousEmail: string; previousMobile: string; actor: string; reason: string;
}): Promise<{ email: string; mobile: string; audit: Array<Record<string, string>> }> {
  const response = await requestLedger<{ record: { email: string; mobile: string; audit: Array<Record<string, string>> } }>(input.eventId, 'contact', 'POST', input);
  return response.record;
}
