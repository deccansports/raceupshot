import { describe, expect, it, vi } from 'vitest';

vi.mock('cloudflare:workers', () => ({ DurableObject: class {
  ctx: unknown;
  env: unknown;
  constructor(ctx: unknown, env: unknown) { this.ctx = ctx; this.env = env; }
} }));
vi.mock('../.open-next/worker.js', () => ({ default: {} }));

import { notificationIdentity } from '../lib/transactional-notification-contract';

class FakeStorage {
  rows = new Map<string, unknown>();
  queue = Promise.resolve();
  async get<T>(key: string): Promise<T | undefined> { return this.rows.get(key) as T | undefined; }
  async put(key: string, value: unknown): Promise<void> { this.rows.set(key, value); }
  async transaction<T>(work: (storage: FakeStorage) => Promise<T>): Promise<T> {
    const run = this.queue.then(() => work(this));
    this.queue = run.then(() => undefined, () => undefined);
    return run;
  }
}

describe('durable notification claims', () => {
  it('permits only one concurrent automatic claim for an exact recipient/channel', async () => {
    const workerPath = '../cloudflare/canonical-change-hub';
    const { CanonicalChangeHub } = await import(workerPath) as { CanonicalChangeHub: new (ctx: unknown, env: unknown) => { fetch(request: Request): Promise<Response> } };
    const storage = new FakeStorage();
    const hub = new CanonicalChangeHub({ storage } as never, {} as never);
    const identity = notificationIdentity('event', 'contest', 'result', 'FINISHER');
    const body = { identity, kind: 'FINISHER', channel: 'EMAIL', eventId: 'event', contestId: 'contest', participantId: 'result', recipient: 'a@example.com', actor: 'SYSTEM' };
    const responses = await Promise.all(Array.from({ length: 10 }, () => hub.fetch(new Request('https://notifications.internal/notification-ledger/claim', { method: 'POST', body: JSON.stringify(body) }))));
    const claims = await Promise.all(responses.map((response) => response.json() as Promise<{ token: string | null }>));
    expect(claims.filter((claim) => claim.token)).toHaveLength(1);
    expect(storage.rows.get('txn-ledger:EMAIL:' + identity)).toMatchObject({ status: 'CLAIMED', eventId: 'event', contestId: 'contest', participantId: 'result' });
  });
});
