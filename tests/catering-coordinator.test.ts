import { describe, expect, it, vi } from 'vitest';
vi.mock('cloudflare:workers', () => ({ DurableObject: class { ctx: unknown; constructor(ctx: unknown) { this.ctx = ctx; } } }));
// Matches the repository's existing coordinator unit-test approach. This is
// a serialized storage double, not a substitute for a workerd integration test.
class Storage {
  rows = new Map<string, unknown>(); queue = Promise.resolve();
  async delete(key: string) { return this.rows.delete(key); }
  async get<T>(key: string | string[]): Promise<T | Map<string, T> | undefined> { return Array.isArray(key) ? new Map(key.filter(value => this.rows.has(value)).map(value => [value, this.rows.get(value) as T])) : this.rows.get(key) as T | undefined; }
  async put(key: string | Record<string, unknown>, value?: unknown) { if (typeof key === 'string') this.rows.set(key, structuredClone(value)); else Object.entries(key).forEach(([name, row]) => this.rows.set(name, structuredClone(row))); }
  async list<T>({ prefix, reverse, limit }: { prefix: string; reverse: boolean; limit: number }) { const keys = [...this.rows.keys()].filter(key => key.startsWith(prefix)).sort(); if (reverse) keys.reverse(); return new Map(keys.slice(0, limit).map(key => [key, this.rows.get(key) as T])); }
  async transaction<T>(work: (storage: Storage) => Promise<T>) { const next = this.queue.then(() => work(this)); this.queue = next.then(() => undefined, () => undefined); return next; }
}
async function setup(totalServings = 10, maxPerRecipient = 1) {
  // Worker sources use a separate Cloudflare type environment, like the
  // existing notification-coordinator suite; do not import them into Next's tsc.
  const workerPath = '../cloudflare/volunteer-operation-coordinator';
  const { VolunteerOperationCoordinator } = await import(workerPath) as { VolunteerOperationCoordinator: new (ctx: unknown, env: unknown) => { fetch(request: Request): Promise<Response> } };
  const storage = new Storage();
  const object = new VolunteerOperationCoordinator({ storage } as never, {} as never);
  const service = { id: 'lunch', name: 'Lunch', kind: 'LUNCH', active: true, athletesEligible: true, volunteersEligible: true, categories: [], startsAt: new Date(Date.now() - 60000).toISOString(), endsAt: new Date(Date.now() + 3600000).toISOString(), totalServings, maxPerRecipient, inventoryQuantity: totalServings, unit: 'plate', purchaseRatePaisa: 10000 };
  const send = (path: string, body: object) => object.fetch(new Request(`https://internal${path}`, { method: 'POST', body: JSON.stringify(body) }));
  expect((await send('/catering/service', service)).status).toBe(200);
  return { storage, object, send, service };
}
const issue = (id: string, requestId = id) => ({ requestId, serviceId: 'lunch', recipient: { id, name: id, identifier: id, audience: 'ATHLETE', category: 'Sprint' }, operatorId: 'operator', operatorName: 'Operator' });
describe('catering coordinator (storage-double tests)', () => {
  it('rejects simultaneous athlete claims for one event tag', async () => {
    const { send } = await setup();
    const responses = await Promise.all(['athlete-1', 'athlete-2'].map(participantId => send('/equipment-code/claim', { kind: 'athlete-band', participantId, code: 'TAG-001' })));
    expect(responses.filter(row => row.ok)).toHaveLength(1);
    expect(responses.filter(row => row.status === 409)).toHaveLength(1);
  });
  it('does not allow category scopes or relay members to share an athlete band', async () => {
    const { send } = await setup();
    expect((await send('/equipment-code/claim', { kind: 'athlete-band', participantId: 'relay-member-1', code: 'TAG-001', scope: 'swim' })).ok).toBe(true);
    expect((await send('/equipment-code/claim', { kind: 'athlete-band', participantId: 'relay-member-2', code: 'tag-001', scope: 'bike' })).status).toBe(409);
  });
  it('allows the same athlete tag in another event and an idempotent owner claim', async () => {
    const first = await setup(), second = await setup();
    const body = { kind: 'athlete-band', participantId: 'athlete-1', code: 'TAG-001' };
    expect((await first.send('/equipment-code/claim', body)).ok).toBe(true);
    expect((await first.send('/equipment-code/claim', body)).ok).toBe(true);
    expect((await second.send('/equipment-code/claim', { ...body, participantId: 'athlete-2' })).ok).toBe(true);
  });
  it('accepts arbitrary QR tags and rejects duplicate ownership in the same event', async () => {
    const { send } = await setup();
    const responses = await Promise.all(['v1', 'v2'].map(volunteerId => send('/volunteer-band/assign', { volunteerId, bandCode: 'external/tag?number=001' })));
    expect(responses.filter(row => row.ok)).toHaveLength(1);
    const lookup = await (await send('/catering/band', { code: 'external/tag?number=001' })).json() as { data: { id: string } };
    expect(['v1', 'v2']).toContain(lookup.data.id);
  });
  it('allows the same tag in different events and idempotent assignment to its owner', async () => {
    const first = await setup(), second = await setup();
    const assign = { volunteerId: 'v1', bandCode: '7' };
    expect((await first.send('/volunteer-band/assign', assign)).ok).toBe(true);
    expect((await first.send('/volunteer-band/assign', assign)).ok).toBe(true);
    expect((await second.send('/volunteer-band/assign', { ...assign, volunteerId: 'v2' })).ok).toBe(true);
  });
  it('uses the same decoding for assignment and catering lookup', async () => {
    const { send } = await setup();
    expect((await send('/volunteer-band/assign', { volunteerId: 'v1', bandCode: '{"bandCode":"custom/001"}' })).ok).toBe(true);
    const lookup = await (await send('/catering/band', { code: 'https://example.com/tag?bandCode=custom%2F001' })).json();
    expect(lookup).toEqual({ ok: true, data: { id: 'v1' } });
    expect((await send('/volunteer-band/assign', { volunteerId: 'v2', bandCode: 'CUSTOM/001' })).status).toBe(409);
  });
  it('accepts only one simultaneous serving per recipient', async () => {
    const { send, storage } = await setup();
    const responses = await Promise.all(Array.from({ length: 10 }, (_, i) => send('/catering/issue', issue('athlete', String(i)))));
    expect(responses.filter(row => row.ok)).toHaveLength(1);
    expect(storage.rows.get('catering:count:lunch')).toBe(1);
  });
  it('does not oversell the final serving', async () => {
    const { send, storage } = await setup(1);
    const responses = await Promise.all([send('/catering/issue', issue('a')), send('/catering/issue', issue('b'))]);
    expect(responses.filter(row => row.ok)).toHaveLength(1);
    expect(storage.rows.get('catering:count:lunch')).toBe(1);
  });
  it('replays network retries without consuming another allowance', async () => {
    const { send, storage } = await setup(10, 2);
    const first = await (await send('/catering/issue', issue('a'))).json();
    const retry = await (await send('/catering/issue', issue('a'))).json();
    expect(retry).toEqual(first); expect(storage.rows.get('catering:count:lunch')).toBe(1);
  });
  it('isolates events and leaves check-in state untouched', async () => {
    const first = await setup(), second = await setup();
    await first.send('/catering/issue', issue('a'));
    expect(second.storage.rows.get('catering:count:lunch')).toBeUndefined();
    expect([...first.storage.rows.keys()].every(key => key.startsWith('catering:'))).toBe(true);
  });
  it('preserves stock basis after serving but allows disabling', async () => {
    const { send, service } = await setup(); await send('/catering/issue', issue('a'));
    expect((await send('/catering/service', { ...service, totalServings: 20 })).status).toBe(400);
    expect((await send('/catering/service', { ...service, active: false })).status).toBe(200);
  });
  it('resolves a configured volunteer food group from its normalized band', async () => {
    const { send } = await setup();
    const group = { id: 'registration', name: 'Registration Team', type: 'VOLUNTEER_GROUP', servingDates: ['2026-10-18'], allowedMeals: ['BREAKFAST'], bandCodes: [' bmv-01 '], active: true };
    expect((await send('/catering/volunteer-group', group)).status).toBe(200);
    const lookup = await (await send('/catering/band', { code: 'BMV-01' })).json() as { data: { group: { name: string; bandCodes: string[] } } };
    expect(lookup.data.group.name).toBe('Registration Team');
    expect(lookup.data.group.bandCodes).toEqual(['BMV-01']);
  });
  it('prevents one band from belonging to multiple volunteer food groups', async () => {
    const { send } = await setup();
    const base = { type: 'VOLUNTEER_GROUP', servingDates: ['2026-10-18'], allowedMeals: ['LUNCH'], bandCodes: ['BMV-01'], active: true };
    expect((await send('/catering/volunteer-group', { ...base, id: 'one', name: 'One' })).status).toBe(200);
    expect((await send('/catering/volunteer-group', { ...base, id: 'two', name: 'Two' })).status).toBe(400);
  });
  it('resets an issued serving idempotently and restores stock', async () => {
    const { send, storage } = await setup();
    const issued = await (await send('/catering/issue', issue('athlete'))).json() as { data: { id: string } };
    expect(storage.rows.get('catering:count:lunch')).toBe(1);
    expect((await send('/catering/reset', { issueId: issued.data.id, resetBy: 'Admin' })).status).toBe(200);
    expect((await send('/catering/reset', { issueId: issued.data.id, resetBy: 'Admin' })).status).toBe(200);
    expect(storage.rows.get('catering:count:lunch')).toBe(0);
  });
});
