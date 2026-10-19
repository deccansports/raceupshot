import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const here = dirname(fileURLToPath(import.meta.url));
const probePath = process.env.RACEUPSHOT_RFID_PROBE_PATH || join(here, 'bin', 'raceupshot-rfid-hid-probe');
const dataDir = process.env.RACEUPSHOT_RFID_DATA_DIR || join(homedir(), 'Library', 'Application Support', 'Race Upshot', 'RFID Encoder');
const pairingFile = join(dataDir, 'pairings.json');
const allowedOrigins = (process.env.RACEUPSHOT_RFID_ALLOWED_ORIGINS || 'https://raceupshot.com,https://www.raceupshot.com,https://raceupshot.hidden-limit-41e6.workers.dev,http://localhost:3001').split(',').map((value) => value.trim()).filter(Boolean);
const listenPort = Number(process.env.RACEUPSHOT_RFID_BRIDGE_PORT || 8766);
const pairingLifetimeMs = 90 * 24 * 60 * 60 * 1000;
const oneTimePairingLifetimeMs = 2 * 60 * 1000;
const pollIntervalMs = 3000;

if (process.platform !== 'darwin') throw new Error('This bridge is macOS-only.');
if (!Number.isInteger(listenPort) || listenPort < 1024 || listenPort > 65535) throw new Error('Invalid bridge port.');
if (!allowedOrigins.length || allowedOrigins.some((origin) => !/^https:\/\/[^/]+$/.test(origin) && !/^http:\/\/localhost:\d+$/.test(origin))) throw new Error('Invalid bridge origin allowlist.');

function loadPairingCode() {
  if (process.env.RACEUPSHOT_RFID_BRIDGE_KEY) return process.env.RACEUPSHOT_RFID_BRIDGE_KEY;
  const result = spawnSync('/usr/bin/security', ['find-generic-password', '-a', process.env.RACEUPSHOT_RFID_KEYCHAIN_ACCOUNT || process.env.USER || '', '-s', 'com.raceupshot.rfid.bridge.pairing', '-w'], { encoding: 'utf8', timeout: 3000 });
  if (result.status !== 0) throw new Error('RFID pairing code is missing from macOS Keychain. Run setup.mjs first.');
  return result.stdout.trim();
}

function keychainValue(service) {
  const result = spawnSync('/usr/bin/security', [
    'find-generic-password', '-a', process.env.RACEUPSHOT_RFID_KEYCHAIN_ACCOUNT || process.env.USER || '',
    '-s', service, '-w',
  ], { encoding: 'utf8', timeout: 3000 });
  return result.status === 0 ? result.stdout.trim() : '';
}

const pairingCode = loadPairingCode();
if (pairingCode.length < 24) throw new Error('RFID pairing code must be at least 24 characters.');
const signingSecret = process.env.RACEUPSHOT_RFID_SIGNING_SECRET || keychainValue('com.raceupshot.rfid.bridge.signing');
const validatedThisMac = keychainValue('com.raceupshot.rfid.bridge.write-validated') === 'PHYSICAL_ACCEPTANCE_PASSED';
const writerValidated = process.env.RACEUPSHOT_RFID_MACOS_WRITE_VALIDATED === '1' || validatedThisMac;
const signedWritesEnabled = writerValidated && signingSecret.length >= 32;
let pairings = [];
const oneTimePairingCodes = new Map();
let status = { state: 'DISCONNECTED', availableReaders: 0, model: 'RU5600-compatible SWUSB_HID', connectionType: 'macOS USB HID', operatingSystem: 'macOS', lastConnectedAt: null, lastDisconnectedAt: null, canReadEpc: false, canWriteEpc: false, error: null };
let polling = false;
let probeQueue = Promise.resolve();
let detectionConfig = {
  rfPowerDbm: null, antennaIds: [], targetRangeCm: 15.24, absenceTimeoutMs: 1000,
  singleReadPerEntry: true, reentryDetection: true, suppressDuplicateInventory: true,
  rssiThreshold: null, presenceMonitoring: true, physicallyCalibrated: false,
  calibrationMethod: 'UNVERIFIED', calibrationNotes: '',
};

function validatedDetectionConfig(input = {}) {
  const next = { ...detectionConfig, ...input };
  if (next.rfPowerDbm !== null && (!Number.isFinite(next.rfPowerDbm) || next.rfPowerDbm < -30 || next.rfPowerDbm > 36)) throw new Error('RF power must be between -30 and 36 dBm.');
  if (!Number.isFinite(next.targetRangeCm) || next.targetRangeCm <= 0 || next.targetRangeCm > 15.24) throw new Error('Detection target cannot exceed 15.24 cm.');
  if (!Number.isInteger(next.absenceTimeoutMs) || next.absenceTimeoutMs < 100 || next.absenceTimeoutMs > 60000) throw new Error('Absence timeout must be between 100 and 60000 ms.');
  if (next.rssiThreshold !== null && (!Number.isFinite(next.rssiThreshold) || next.rssiThreshold < -120 || next.rssiThreshold > 0)) throw new Error('RSSI threshold must be between -120 and 0 dBm.');
  next.antennaIds = [...new Set((Array.isArray(next.antennaIds) ? next.antennaIds : []).map(Number))];
  if (next.antennaIds.some((value) => !Number.isInteger(value) || value < 1 || value > 64)) throw new Error('Invalid antenna selection.');
  if (next.physicallyCalibrated && (next.calibrationMethod === 'UNVERIFIED' || String(next.calibrationNotes || '').trim().length < 10)) throw new Error('Physical calibration requires a method and bench-test notes.');
  next.calibrationNotes = String(next.calibrationNotes || '').trim();
  return next;
}

function queueProbe(operation) {
  const queued = probeQueue.then(operation);
  probeQueue = queued.catch(() => undefined);
  return queued;
}

function equalSecret(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && timingSafeEqual(a, b);
}

function hashToken(token) { return createHash('sha256').update(token).digest('hex'); }

async function savePairings() {
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  await writeFile(pairingFile, JSON.stringify(pairings, null, 2), { mode: 0o600 });
}

try {
  const loaded = JSON.parse(await readFile(pairingFile, 'utf8'));
  if (Array.isArray(loaded)) pairings = loaded.filter((item) => allowedOrigins.includes(item?.origin) && item?.expiresAt > Date.now() && /^[a-f0-9]{64}$/.test(item?.hash || ''));
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}

async function tokenAuthorized(token, origin) {
  if (!/^[a-f0-9]{64}$/.test(token || '')) return false;
  const candidate = hashToken(token);
  const pairing = pairings.find((item) => item.origin === origin && item.expiresAt > Date.now() && equalSecret(item.hash, candidate));
  if (!pairing) return false;
  if (pairing.expiresAt < Date.now() + 30 * 24 * 60 * 60 * 1000) {
    pairing.expiresAt = Date.now() + pairingLifetimeMs;
    await savePairings();
  }
  return true;
}

function runProbe(args = ['--status-json'], marker = 'RACEUPSHOT_STATUS_JSON:', extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(probePath, args, { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...extraEnv } });
    let output = '';
    let errors = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), args[0] === '--write-once' ? 75000 : ['--read-json', '--scan-json'].includes(args[0]) ? 35000 : 7000);
    child.stdout.on('data', (chunk) => { output += chunk.toString(); if (output.length > 20000) child.kill('SIGKILL'); });
    child.stderr.on('data', (chunk) => { errors += chunk.toString(); if (errors.length > 2000) child.kill('SIGKILL'); });
    child.on('error', reject);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      const line = output.split('\n').find((entry) => entry.startsWith(marker));
      if (!line) return reject(new Error(`Native USB ${args[0]} response unavailable (exit ${code ?? 'none'}, signal ${signal || 'none'})${errors ? ': ' + errors.slice(0, 120) : '.'}`));
      try { resolve(JSON.parse(line.slice(marker.length))); }
      catch { reject(new Error('Native USB status was malformed.')); }
    });
  });
}

async function poll() {
  if (polling) return;
  polling = true;
  try {
    const next = await queueProbe(() => runProbe());
    const previous = status.state;
    status = { ...status, ...next, canWriteEpc: Boolean(next.canReadEpc && signedWritesEnabled), operatingSystem: 'macOS', error: next.error || null };
    if (next.state === 'CONNECTED' && previous !== 'CONNECTED') status.lastConnectedAt = new Date().toISOString();
    if (next.state !== 'CONNECTED' && previous === 'CONNECTED') status.lastDisconnectedAt = new Date().toISOString();
    if (next.state !== previous) console.log(`[rfid-bridge] reader ${previous} -> ${next.state}`);
  } catch (error) {
    if (status.state === 'CONNECTED') status.lastDisconnectedAt = new Date().toISOString();
    status = { ...status, state: 'ERROR', error: error instanceof Error ? error.message : String(error) };
  } finally { polling = false; }
}

await poll();
setInterval(() => void poll(), pollIntervalMs).unref();

async function readJson(request) {
  let value = '';
  for await (const chunk of request) {
    value += chunk.toString();
    if (value.length > 16384) throw new Error('Request too large.');
  }
  return value ? JSON.parse(value) : {};
}

function send(response, code, data) {
  response.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(data));
}

function sign(value) {
  return createHmac('sha256', signingSecret).update(value).digest('hex').toUpperCase();
}

function wholeWordEpc(value) { return typeof value === 'string' && /^(?:[0-9A-F]{4}){1,21}$/.test(value); }

function writePermitError(command) {
  const { currentEpc, tid, newEpc, transactionId, expiresAtMs, signature } = command;
  if (!wholeWordEpc(currentEpc) || !wholeWordEpc(newEpc)
      || typeof tid !== 'string' || !/^[0-9A-F]{24}$/.test(tid)
      || currentEpc === newEpc || typeof transactionId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(transactionId)
      || !Number.isSafeInteger(expiresAtMs) || expiresAtMs <= Date.now() || expiresAtMs > Date.now() + 120_000
      || typeof signature !== 'string' || !/^[0-9A-Fa-f]{64}$/.test(signature)) return 'Cloud write permit is malformed or expired.';
  const expected = sign(`WRITE|${transactionId}|${currentEpc}|${tid}|${newEpc}|${expiresAtMs}`);
  return equalSecret(signature.toUpperCase(), expected) ? null : 'Cloud and local RFID signing keys do not match.';
}

const server = createServer(async (request, response) => {
  const origin = request.headers.origin;
  const path = new URL(request.url || '/', `http://127.0.0.1:${listenPort}`).pathname;
  if (!origin && request.method === 'GET' && (path === '/' || path === '/health')) {
    return send(response, 200, { bridge: 'RUNNING', message: 'Open RACEUPSHOT Admin > RFID Encoder to pair this browser and use the reader.' });
  }
  if (!allowedOrigins.includes(origin)) return send(response, 403, { error: 'Origin is not authorized for the local RFID bridge.' });
  response.setHeader('Access-Control-Allow-Origin', origin);
  response.setHeader('Vary', 'Origin');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-RFID-Bridge-Key');
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Private-Network', 'true');
  if (request.method === 'OPTIONS') return send(response, 204, {});
  try {
    if (path === '/health' && request.method === 'GET') return send(response, 200, { bridge: 'RUNNING', pairingRequired: true });
    if (path === '/pair-code' && request.method === 'POST') {
      const code = randomBytes(18).toString('base64url');
      const expiresAt = Date.now() + oneTimePairingLifetimeMs;
      // Only the latest code for this allowlisted Race Upshot origin remains valid.
      // The future browser token exists only in this two-minute in-memory
      // record. Persistent storage receives only its hash after redemption.
      oneTimePairingCodes.set(origin, { hash: hashToken(code), expiresAt, token: randomBytes(32).toString('hex'), redeemed: false });
      return send(response, 200, { code, expiresAt: new Date(expiresAt).toISOString() });
    }
    if (path === '/pair' && request.method === 'POST') {
      const { code } = await readJson(request);
      const pendingCode = oneTimePairingCodes.get(origin);
      const oneTimeCodeValid = Boolean(pendingCode && pendingCode.expiresAt > Date.now()
        && equalSecret(hashToken(code || ''), pendingCode.hash));
      if (!oneTimeCodeValid && !equalSecret(code || '', pairingCode)) return send(response, 401, { error: 'Invalid or expired local pairing code.' });
      // Retain a redeemed one-time code until its original expiry so a browser
      // can retry after a lost response and receive the same token.
      const token = oneTimeCodeValid ? pendingCode.token : randomBytes(32).toString('hex');
      const tokenHash = hashToken(token);
      if (!pairings.some((item) => item.origin === origin && equalSecret(item.hash, tokenHash))) {
        pairings.push({ hash: tokenHash, origin, expiresAt: Date.now() + pairingLifetimeMs });
      }
      if (oneTimeCodeValid) pendingCode.redeemed = true;
      await savePairings();
      return send(response, 200, { token, expiresAt: new Date(Date.now() + pairingLifetimeMs).toISOString() });
    }
    if (!await tokenAuthorized(request.headers['x-rfid-bridge-key'], origin)) return send(response, 401, { error: 'Pair with this local RFID bridge first.' });
    if (path === '/unpair' && request.method === 'POST') {
      const hash = hashToken(request.headers['x-rfid-bridge-key']);
      pairings = pairings.filter((item) => item.hash !== hash);
      await savePairings();
      return send(response, 200, { revoked: true });
    }
    if (path === '/status' && request.method === 'GET') return send(response, 200, { ...status, detectionConfig });
    if (path === '/check-signing' && request.method === 'POST') {
      if (!signedWritesEnabled) return send(response, 501, { error: 'Signed RFID writing is not enabled on this Mac.' });
      const { nonce, expiresAtMs, signature } = await readJson(request);
      if (typeof nonce !== 'string' || !/^[0-9A-F]{32}$/.test(nonce) || !Number.isSafeInteger(expiresAtMs)
          || typeof signature !== 'string' || !/^[0-9A-Fa-f]{64}$/.test(signature)) return send(response, 400, { error: 'RFID signing preflight is malformed.' });
      if (!equalSecret(signature.toUpperCase(), sign(`PREFLIGHT|${nonce}|${expiresAtMs}`))) return send(response, 409, { error: 'Cloud and local RFID signing keys do not match. No EPC was reserved or written.' });
      if (expiresAtMs <= Date.now() || expiresAtMs > Date.now() + 120_000) return send(response, 409, { error: 'Cloud and local reader clocks differ or the preflight expired. No EPC was reserved or written.' });
      return send(response, 200, { verified: true });
    }
    if (path === '/connect' && request.method === 'POST') { await poll(); return send(response, 200, status); }
    if (path === '/disconnect' && request.method === 'POST') return send(response, 409, { error: 'This reader is auto-managed. Unplug it to disconnect.' });
    if (path === '/configuration' && request.method === 'POST') {
      detectionConfig = validatedDetectionConfig(await readJson(request));
      return send(response, 200, {
        config: detectionConfig, rfPowerApplied: false,
        antennaSelectionApplied: detectionConfig.antennaIds.length > 0,
        rssiFilterApplied: detectionConfig.rssiThreshold !== null,
        hardwareRangeGuaranteed: false,
        warnings: ['The audited macOS HID probe has no verified RF-power command. Validate the 15.24 cm zone using a near-field antenna and/or shielding.'],
      });
    }
    if (path === '/read' && request.method === 'POST') {
      if (status.state !== 'CONNECTED' || status.availableReaders !== 1) return send(response, 409, { error: 'Connect exactly one RU5600 reader before reading a chip.' });
      const result = await queueProbe(() => runProbe(['--scan-json'], 'RACEUPSHOT_SCAN_JSON:'));
      if (result.error === 'One stable tag was not detected') return send(response, 200, { tags: [], rawResponses: Number(result.reports) || 0, sampleComplete: !result.reports });
      if (result.error === 'Multiple tags detected') return send(response, 409, { error: result.error, rawResponses: Number(result.reports) || 0, sampleComplete: false });
      if (result.error) return send(response, 409, { error: result.error, rawResponses: Number(result.reports) || 0, sampleComplete: false });
      if (!Array.isArray(result.tags) || result.tags.length !== 1 || !wholeWordEpc(result.tags[0]?.epc)
          || !/^[0-9A-F]{24}$/.test(result.tags[0]?.tid || '') || !/^[0-9A-F]{4}$/.test(result.tags[0]?.pc || '')) {
        return send(response, 502, { error: 'Native reader returned an invalid full EPC, PC or TID response.' });
      }
      return send(response, 200, { tags: [{ ...result.tags[0], readAt: new Date().toISOString(), readCount: 1 }], rawResponses: Number(result.reports) || 0, sampleComplete: true });
    }
    if (path === '/write' && request.method === 'POST') {
      if (!signedWritesEnabled) return send(response, 501, { error: 'Signed cloud writes require physical validation and a shared signing key.' });
      if (status.state !== 'CONNECTED' || status.availableReaders !== 1) return send(response, 409, { error: 'Exactly one RU5600 reader must be connected.' });
      const command = await readJson(request);
      const permitError = writePermitError(command);
      if (permitError) return send(response, 403, { error: permitError });
      const result = await queueProbe(() => runProbe(
        ['--write-once', command.currentEpc, command.tid, command.newEpc], 'RACEUPSHOT_WRITE_JSON:',
        { RACEUPSHOT_RFID_HARDWARE_TEST_EPC: command.newEpc },
      ));
      if (result.state !== 'VERIFIED' || result.after?.epc !== command.newEpc || result.after?.tid !== command.tid) {
        return send(response, 409, { state: result.state || 'UNKNOWN_OUTCOME', error: result.error || 'Physical write was not verified.' });
      }
      if (!/^[0-9A-F]{4}$/.test(result.after.pc || '')) return send(response, 409, { state: 'UNKNOWN_OUTCOME', error: 'Same-TID Stored PC read-back was unavailable. Review the physical tag before another write.' });
      return send(response, 200, { after: result.after, attestation: sign(`WRITE|${command.transactionId}|${result.after.epc}|${result.after.tid}|${result.after.pc}`) });
    }
    if (path === '/review' && request.method === 'POST') {
      if (!signedWritesEnabled) return send(response, 501, { error: 'Signed RFID review requires physical validation and a shared signing key.' });
      const { transactionId } = await readJson(request);
      if (typeof transactionId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(transactionId)) return send(response, 400, { error: 'Invalid transaction ID.' });
      const result = await queueProbe(() => runProbe(['--scan-json'], 'RACEUPSHOT_SCAN_JSON:'));
      if (result.error || result.tags?.length !== 1) return send(response, 409, { error: result.error || 'A single physical tag was not read.' });
      const actual = result.tags[0];
      if (!actual.tid || !actual.pc) return send(response, 409, { error: 'Review requires the same physical TID and Stored PC read.' });
      return send(response, 200, { actual, attestation: sign(`REVIEW|${transactionId}|${actual.epc}|${actual.tid}|${actual.pc}`) });
    }
    return send(response, 404, { error: 'Unknown RFID bridge route.' });
  } catch (error) { return send(response, 400, { error: error instanceof Error ? error.message : String(error) }); }
});

server.listen(listenPort, '127.0.0.1', () => console.log(`[rfid-bridge] listening on 127.0.0.1:${listenPort}; origins ${allowedOrigins.join(', ')}`));
