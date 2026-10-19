import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomInt } from 'node:crypto';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

test('pairing redemption is origin-bound, retry-idempotent, verified and revocable', async (context) => {
  if (process.platform !== 'darwin') return context.skip('macOS bridge contract');
  const temp = await mkdtemp(join(tmpdir(), 'raceupshot-rfid-pairing-'));
  const probe = join(temp, 'probe');
  await writeFile(probe, '#!/bin/sh\necho \'RACEUPSHOT_STATUS_JSON:{"state":"DISCONNECTED","availableReaders":0,"canReadEpc":false,"canWriteEpc":false}\'\n');
  await chmod(probe, 0o700);
  const port = 18766 + randomInt(1000);
  const origin = 'http://localhost:3001';
  const child = spawn(process.execPath, [fileURLToPath(new URL('./bridge.mjs', import.meta.url))], { env: {
    ...process.env, RACEUPSHOT_RFID_PROBE_PATH: probe, RACEUPSHOT_RFID_DATA_DIR: temp,
    RACEUPSHOT_RFID_BRIDGE_KEY: 'master-pairing-key-for-contract-test',
    RACEUPSHOT_RFID_ALLOWED_ORIGINS: origin, RACEUPSHOT_RFID_BRIDGE_PORT: String(port),
  }, stdio: ['ignore', 'pipe', 'pipe'] });
  const call = async (path, body, token, requestOrigin = origin) => fetch(`http://127.0.0.1:${port}${path}`, {
    method: body ? 'POST' : 'GET', headers: { Origin: requestOrigin, ...(token ? { 'X-RFID-Bridge-Key': token } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  try {
    for (let attempt = 0; attempt < 30; attempt += 1) { try { if ((await call('/health')).ok) break; } catch { await new Promise((resolve) => setTimeout(resolve, 50)); } }
    const generated = await (await call('/pair-code', {})).json();
    assert.match(generated.code, /^[A-Za-z0-9_-]{24}$/);
    const first = await (await call('/pair', { code: generated.code })).json();
    const retry = await (await call('/pair', { code: generated.code })).json();
    assert.equal(first.token, retry.token);
    assert.equal((await call('/status', undefined, first.token)).status, 200);
    assert.equal((await call('/status', undefined, first.token, 'http://localhost:3999')).status, 403);
    assert.equal((await call('/unpair', {}, first.token)).status, 200);
    assert.equal((await call('/status', undefined, first.token)).status, 401);
  } finally {
    child.kill('SIGTERM');
    await rm(temp, { recursive: true, force: true });
  }
});
