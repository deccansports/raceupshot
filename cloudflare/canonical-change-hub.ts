import { DurableObject } from 'cloudflare:workers';
import type { CanonicalChangeEvent, CanonicalStreamReadyEvent } from '../packages/live-tracking-contracts/src/canonical-change';
import { canReserveResultNotificationClaim } from '../lib/result-notification-claim';
import { appendAttempt, canClaimNotification, notificationIdentity, type NotificationActor, type NotificationAttempt, type NotificationLedgerRecord, type TransactionalChannel, type TransactionalKind } from '../lib/transactional-notification-contract';
import openNextWorker from '../.open-next/worker.js';

interface LiveSyncSchedule {
  eventId: string;
  enabled: boolean;
  intervalMs: number;
}

export class CanonicalChangeHub extends DurableObject<CloudflareEnv> {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/notification-ledger/records' && request.method === 'GET') {
      const records = await this.ctx.storage.list<NotificationLedgerRecord>({ prefix: 'txn-ledger:' });
      return Response.json({ records: [...records.values()] });
    }
    if (url.pathname === '/notification-ledger/claim' && request.method === 'POST') {
      const body = await request.json<{ identity: string; kind: TransactionalKind; channel: TransactionalChannel; eventId: string; contestId: string; participantId: string; recipient: string; actor: NotificationActor; retryFailed?: boolean; forceResend?: boolean; confirmed?: boolean; legacyAccepted?: boolean }>();
      if (!body.identity || !body.eventId || !body.contestId || !body.participantId || !body.recipient || !['EMAIL', 'WHATSAPP'].includes(body.channel) || !['FINISHER', 'REGISTRATION'].includes(body.kind) || !['SYSTEM', 'ADMIN'].includes(body.actor) || body.identity !== notificationIdentity(body.eventId, body.contestId, body.participantId, body.kind)) return Response.json({ error: 'Invalid notification claim.' }, { status: 400 });
      const key = `txn-ledger:${body.channel}:${body.identity}`;
      const now = new Date().toISOString();
      const result = await this.ctx.storage.transaction(async (transaction) => {
        let previous = await transaction.get<NotificationLedgerRecord>(key);
        if (body.legacyAccepted && !previous) {
          previous = { identity: body.identity, kind: body.kind, channel: body.channel, eventId: body.eventId, contestId: body.contestId, participantId: body.participantId, recipient: body.recipient, status: 'PROVIDER_ACCEPTED', attempts: [{ id: crypto.randomUUID(), at: now, actor: 'SYSTEM', channel: body.channel, recipient: body.recipient, state: 'PROVIDER_ACCEPTED', reason: 'Migrated from prior accepted provider record.' }], updatedAt: now, skipReason: 'LEGACY_PROVIDER_ACCEPTED' };
          await transaction.put(key, previous);
        }
        const everAccepted = previous?.attempts.some((attempt) => attempt.state === 'PROVIDER_ACCEPTED') || previous?.skipReason === 'LEGACY_PROVIDER_ACCEPTED';
        if ((everAccepted && !(body.actor === 'ADMIN' && body.forceResend === true && body.confirmed === true)) || !canClaimNotification(previous?.status, { actor: body.actor, retryFailed: body.retryFailed === true, forceResend: body.forceResend === true, confirmed: body.confirmed === true })) return { token: null, reason: previous?.status || 'CLAIM_BLOCKED' };
        const bucketKey = 'txn-rate:rolling-minute';
        const minute = Math.floor(Date.now() / 60_000);
        const bucket = await transaction.get<{ minute: number; count: number }>(bucketKey);
        const count = bucket?.minute === minute ? bucket.count : 0;
        if (count >= 60) return { token: null, reason: 'RATE_LIMITED' };
        const token = crypto.randomUUID();
        await transaction.put(bucketKey, { minute, count: count + 1 });
        const claimAttempt: NotificationAttempt = { id: token, at: now, actor: body.actor, channel: body.channel, recipient: body.recipient, state: 'CLAIMED' };
        await transaction.put(key, { identity: body.identity, kind: body.kind, channel: body.channel, eventId: body.eventId, contestId: body.contestId, participantId: body.participantId, recipient: body.recipient, status: 'CLAIMED', claimToken: token, attempts: [...(previous?.attempts ?? []), claimAttempt], updatedAt: now } satisfies NotificationLedgerRecord);
        return { token, reason: '' };
      });
      return Response.json(result);
    }
    if (url.pathname === '/notification-ledger/complete' && request.method === 'POST') {
      const body = await request.json<{ identity: string; channel: TransactionalChannel; token: string; state: NotificationAttempt['state']; providerStatus?: string; providerResponse?: string; reason?: string; actor: NotificationActor; recipient: string }>();
      if (!body.identity || !body.token || !['EMAIL', 'WHATSAPP'].includes(body.channel) || !['PROVIDER_ACCEPTED', 'FAILED', 'UNCONFIRMED', 'SKIPPED'].includes(body.state)) return Response.json({ error: 'Invalid notification completion.' }, { status: 400 });
      const key = `txn-ledger:${body.channel}:${body.identity}`;
      try {
        const record = await this.ctx.storage.transaction(async (transaction) => {
          const previous = await transaction.get<NotificationLedgerRecord>(key) ?? null;
          const attempt: NotificationAttempt = { id: crypto.randomUUID(), at: new Date().toISOString(), actor: body.actor, channel: body.channel, recipient: body.recipient, state: body.state, providerStatus: String(body.providerStatus ?? '').slice(0, 120), providerResponse: String(body.providerResponse ?? '').slice(0, 500), reason: String(body.reason ?? '').slice(0, 500) };
          const next = appendAttempt(previous, attempt, body.token);
          await transaction.put(key, next);
          return next;
        });
        return Response.json({ record });
      } catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'Ledger completion failed.' }, { status: 409 }); }
    }
    if (url.pathname === '/notification-ledger/skip' && request.method === 'POST') {
      const body = await request.json<{ identity: string; kind: TransactionalKind; channel: TransactionalChannel; eventId: string; contestId: string; participantId: string; recipient: string; actor: NotificationActor; reason: string }>();
      if (!body.reason || !['EMAIL', 'WHATSAPP'].includes(body.channel) || body.identity !== notificationIdentity(body.eventId, body.contestId, body.participantId, body.kind)) return Response.json({ error: 'Invalid notification skip.' }, { status: 400 });
      const key = `txn-ledger:${body.channel}:${body.identity}`;
      const record = await this.ctx.storage.transaction(async (transaction) => {
        const previous = await transaction.get<NotificationLedgerRecord>(key);
        if (previous?.status === 'CLAIMED' || previous?.skipReason === body.reason) return previous;
        const now = new Date().toISOString();
        const attempt: NotificationAttempt = { id: crypto.randomUUID(), at: now, actor: body.actor, channel: body.channel, recipient: body.recipient, state: 'SKIPPED', reason: body.reason.slice(0, 500) };
        const next: NotificationLedgerRecord = { identity: body.identity, kind: body.kind, channel: body.channel, eventId: body.eventId, contestId: body.contestId, participantId: body.participantId, recipient: body.recipient, status: previous?.status === 'PROVIDER_ACCEPTED' || previous?.status === 'FAILED' || previous?.status === 'UNCONFIRMED' ? previous.status : 'SKIPPED', attempts: [...(previous?.attempts ?? []), attempt], updatedAt: now, skipReason: body.reason.slice(0, 500) };
        await transaction.put(key, next);
        return next;
      });
      return Response.json({ record });
    }
    if (url.pathname === '/notification-ledger/contact' && request.method === 'POST') {
      const body = await request.json<{ identity: string; eventId: string; contestId: string; participantId: string; email: string; mobile: string; previousEmail: string; previousMobile: string; actor: string; reason: string }>();
      if (!body.identity || !body.eventId || !body.contestId || !body.participantId || !body.actor || body.reason?.trim().length < 5 || body.identity !== notificationIdentity(body.eventId, body.contestId, body.participantId, 'FINISHER')) return Response.json({ error: 'Contact correction requires an exact identity and audit reason.' }, { status: 400 });
      const key = `txn-contact:${body.identity}`;
      const record = await this.ctx.storage.transaction(async (transaction) => {
        const current = await transaction.get<{ email: string; mobile: string; audit: Array<Record<string, string>> }>(key);
        const audit = { id: crypto.randomUUID(), at: new Date().toISOString(), actor: body.actor, reason: body.reason.trim(), previousEmail: current?.email ?? body.previousEmail ?? '', previousMobile: current?.mobile ?? body.previousMobile ?? '', email: body.email.trim(), mobile: body.mobile.trim() };
        const next = { email: audit.email, mobile: audit.mobile, audit: [...(current?.audit ?? []), audit] };
        await transaction.put(key, next);
        return next;
      });
      return Response.json({ record });
    }
    if (url.pathname === '/notification-ledger/contacts' && request.method === 'GET') {
      const records = await this.ctx.storage.list<{ email: string; mobile: string; audit: Array<Record<string, string>> }>({ prefix: 'txn-contact:' });
      return Response.json({ contacts: Object.fromEntries([...records].map(([key, value]) => [key.slice('txn-contact:'.length), value])) });
    }
    // These routes are binding-only. They run in result-notifications:<eventId>
    // instances, separate from canonical stream/live-sync instances.
    if (request.method === 'POST' && url.pathname === '/schedule-results') {
      const { eventId } = await request.json<{ eventId: string }>();
      if (!eventId?.trim()) return new Response('eventId required', { status: 400 });
      await this.ctx.storage.put('resultNotificationEventId', eventId);
      await this.ctx.storage.put('resultNotificationGeneration', crypto.randomUUID());
      if (await this.ctx.storage.getAlarm() === null) await this.ctx.storage.setAlarm(Date.now() + 1000);
      return Response.json({ ok: true });
    }
    if (request.method === 'POST' && url.pathname === '/claim-result') {
      const body = await request.json<{ identity: string; channel: string; retryFailed?: boolean; forceResend?: boolean }>();
      if (!body.identity || !['EMAIL', 'WHATSAPP'].includes(body.channel)) return new Response('Invalid claim', { status: 400 });
      const key = `result-claim:${body.channel}:${body.identity}`;
      const token = await this.ctx.storage.transaction(async txn => {
        const old = await txn.get<{ status: string }>(key);
        if (!canReserveResultNotificationClaim(old?.status, body.retryFailed, body.forceResend)) return null;
        const token = crypto.randomUUID();
        await txn.put(key, { schemaVersion: 1, token, status: 'SENDING', attemptedAt: new Date().toISOString() });
        return token;
      });
      return Response.json({ token });
    }
    if (request.method === 'POST' && url.pathname === '/complete-result') {
      const body = await request.json<{ identity: string; channel: string; token: string; status: string }>();
      if (!['ACCEPTED', 'FAILED'].includes(body.status)) return new Response('Invalid status', { status: 400 });
      const key = `result-claim:${body.channel}:${body.identity}`;
      await this.ctx.storage.transaction(async txn => {
        const old = await txn.get<{ token: string }>(key);
        if (old?.token !== body.token) throw new Error('Claim token mismatch');
        await txn.put(key, { ...old, status: body.status, completedAt: new Date().toISOString() });
      });
      return Response.json({ ok: true });
    }
    if (request.method === 'POST' && url.pathname === '/publish') {
      const event = await request.json<CanonicalChangeEvent>();
      const serialized = JSON.stringify(event);
      let delivered = 0;
      for (const socket of this.ctx.getWebSockets()) {
        try {
          socket.send(serialized);
          delivered += 1;
        } catch {
          try { socket.close(1011, 'Canonical stream delivery failed'); } catch { /* already closed */ }
        }
      }
      return Response.json({ ok: true, delivered });
    }

    if (request.method === 'POST' && url.pathname === '/configure-live-sync') {
      const body = await request.json<LiveSyncSchedule>();
      const schedule: LiveSyncSchedule = {
        eventId: String(body.eventId || '').trim(),
        enabled: body.enabled === true,
        intervalMs: Math.max(5_000, Math.min(60_000, Number(body.intervalMs) || 10_000)),
      };
      if (!schedule.eventId) return Response.json({ ok: false, error: 'eventId is required' }, { status: 400 });
      await this.ctx.storage.put('liveSyncSchedule', schedule);
      if (schedule.enabled) {
        if (await this.ctx.storage.getAlarm() === null) await this.ctx.storage.setAlarm(Date.now() + schedule.intervalMs);
      } else {
        await this.ctx.storage.deleteAlarm();
      }
      return Response.json({ ok: true, schedule });
    }

    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected Upgrade: websocket', { status: 426 });
    }
    const eventId = url.searchParams.get('eventId')?.trim();
    if (!eventId) return new Response('eventId is required', { status: 400 });
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ eventId, connectedAt: new Date().toISOString() });
    const ready: CanonicalStreamReadyEvent = { type: 'canonical_stream_ready', eventId, connectedAt: new Date().toISOString() };
    server.send(JSON.stringify(ready));
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== 'string') return;
    if (message === 'ping') socket.send('pong');
  }

  async webSocketClose(socket: WebSocket, code: number, reason: string): Promise<void> {
    try { socket.close(code, reason); } catch { /* runtime may already have closed it */ }
  }

  async alarm(): Promise<void> {
    const resultEventId = await this.ctx.storage.get<string>('resultNotificationEventId');
    if (resultEventId) {
      const generation = await this.ctx.storage.get<string>('resultNotificationGeneration');
      // Keep a retry wake-up for infrastructure failures, not ambiguous provider sends.
      await this.ctx.storage.setAlarm(Date.now() + 30_000);
      const secret = this.env.ADMIN_SESSION_SECRET;
      if (!secret) throw new Error('Internal notification authorization unavailable');
      const request = new Request(`https://raceupshot.internal/api/v1/internal/events/${encodeURIComponent(resultEventId)}/result-notifications`, {
        method: 'POST', headers: { 'x-raceupshot-internal-secret': secret },
      });
      const response = await openNextWorker.fetch(request, this.env, {
        waitUntil: (promise: Promise<unknown>) => this.ctx.waitUntil(promise), passThroughOnException: () => undefined,
      } as ExecutionContext);
      if (!response.ok) throw new Error('Automatic result notification processing failed');
      const body = await response.json() as { pending: number };
      if (!body.pending && generation === await this.ctx.storage.get<string>('resultNotificationGeneration')) await this.ctx.storage.deleteAlarm();
      return;
    }
    const schedule = await this.ctx.storage.get<LiveSyncSchedule>('liveSyncSchedule');
    if (!schedule?.enabled || !schedule.eventId) return;
    // Persist the next wake-up before external/provider work begins. Durable
    // Object alarms are at-least-once; this keeps the recurring loop alive
    // even when a provider call or OpenNext request is interrupted.
    await this.ctx.storage.setAlarm(Date.now() + schedule.intervalMs);
    try {
      const secret = this.env.ADMIN_SESSION_SECRET || '';
      if (!secret) throw new Error('ADMIN_SESSION_SECRET is unavailable for the internal live sync.');
      const request = new Request(`https://raceupshot.internal/api/v1/internal/events/${encodeURIComponent(schedule.eventId)}/feibot-live-sync`, {
        method: 'POST',
        headers: { 'x-raceupshot-internal-secret': secret },
      });
      const executionContext = {
        waitUntil: (promise: Promise<unknown>) => this.ctx.waitUntil(promise),
        passThroughOnException: () => undefined,
      } as ExecutionContext;
      const response = await openNextWorker.fetch(request, this.env, executionContext);
      if (!response.ok) throw new Error(`Internal live sync returned HTTP ${response.status}.`);
    } catch (error) {
      console.error(JSON.stringify({ type: 'feibot_live_sync_alarm_failed', eventId: schedule.eventId, error: error instanceof Error ? error.message : String(error) }));
    }
  }
}
