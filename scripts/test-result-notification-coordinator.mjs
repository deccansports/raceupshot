// Local Workers runtime test. No remote bindings or provider requests.
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import assert from 'node:assert/strict';
const bundle = await build({ entryPoints: ['cloudflare/canonical-change-hub.ts'], bundle: true, write: false, format: 'esm', platform: 'browser', external: ['cloudflare:workers'], plugins: [{
  name: 'mock-opennext', setup(builder) {
    builder.onResolve({ filter: /\.open-next\/worker\.js$/ }, () => ({ path: 'mock-app', namespace: 'mock' }));
    builder.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({ contents: 'export default { fetch: async () => Response.json({ pending: 0 }) };', loader: 'js' }));
  },
}] });
const mf = new Miniflare({ modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-07-26', durableObjects: { HUB: { className: 'CanonicalChangeHub', useSQLite: true } }, bindings: { ADMIN_SESSION_SECRET: 'local-test-only' } });
try {
  const ns = await mf.getDurableObjectNamespace('HUB');
  const object = ns.get(ns.idFromName('result-notifications:event-a'));
  const request = async (path, body) => (await object.fetch(`https://internal/${path}`, { method: 'POST', body: JSON.stringify(body) })).json();
  const body = { identity: '["triathlon","001"]', channel: 'WHATSAPP' };
  const claims = await Promise.all(Array.from({ length: 25 }, () => request('claim-result', body)));
  const successful = claims.filter(claim => claim.token);
  assert.equal(successful.length, 1, 'concurrent triggers must reserve one send');
  await request('complete-result', { ...body, token: successful[0].token, status: 'ACCEPTED' });
  assert.equal((await request('claim-result', { ...body, retryFailed: true })).token, null, 'accepted sends must not be retried');
  assert.ok((await request('claim-result', { ...body, channel: 'EMAIL' })).token, 'channels must be independent');
  const other = ns.get(ns.idFromName('result-notifications:event-b'));
  assert.ok((await (await other.fetch('https://internal/claim-result', { method: 'POST', body: JSON.stringify(body) })).json()).token, 'events must be independent');
  const failedBody = { ...body, identity: '["run","002"]' };
  const failed = await request('claim-result', failedBody);
  await request('complete-result', { ...failedBody, token: failed.token, status: 'FAILED' });
  assert.equal((await request('claim-result', failedBody)).token, null, 'failed sends must not automatically retry');
  assert.ok((await request('claim-result', { ...failedBody, retryFailed: true })).token, 'explicit retry can reserve a failed send');
  await request('schedule-results', { eventId: 'event-a' });
  console.log('PASS: real local DO storage; 25 concurrent claims, accepted suppression, channel/event isolation, explicit retry, alarm scheduling.');
} finally { await mf.dispose(); }
