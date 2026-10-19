import { spawnSync } from 'node:child_process';
import { readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

if (process.platform !== 'darwin') throw new Error('This updater is macOS-only.');
const launchAgent = join(homedir(), 'Library', 'LaunchAgents', 'com.raceupshot.rfid-bridge.plist');
const origin = process.argv[2];
if (!origin || (!/^https:\/\/[^/]+$/.test(origin) && !/^http:\/\/localhost:\d+$/.test(origin))) throw new Error('Usage: node tools/rfid-bridge-macos/update-origins.mjs https://trusted-raceupshot-domain');
const run = (command, args) => { const result = spawnSync(command, args, { encoding: 'utf8', timeout: 30000 }); if (result.status !== 0) throw new Error(`${command} failed: ${(result.stderr || result.stdout || '').slice(0, 400)}`); };
const original = await readFile(launchAgent, 'utf8');
if (!original.includes('<key>Label</key><string>com.raceupshot.rfid-bridge</string>')) throw new Error('Installed service is not the Race Upshot RFID bridge.');
const key = /(<key>RACEUPSHOT_RFID_ALLOWED_ORIGINS<\/key><string>)([^<]*)(<\/string>)/;
const match = original.match(key);
if (!match) throw new Error('Installed bridge has no origin allowlist.');
const origins = match[2].split(',').map((value) => value.trim()).filter(Boolean);
if (origins.includes(origin)) { console.log(`${origin} is already authorized.`); process.exit(0); }
const temporary = `${launchAgent}.new-${process.pid}`;
await writeFile(temporary, original.replace(key, `$1${[...origins, origin].join(',')}$3`), { mode: 0o600, flag: 'wx' });
try {
  run('/usr/bin/plutil', ['-lint', temporary]);
  run('/bin/launchctl', ['bootout', `gui/${process.getuid()}/com.raceupshot.rfid-bridge`]);
  await rename(temporary, launchAgent);
  run('/bin/launchctl', ['bootstrap', `gui/${process.getuid()}`, launchAgent]);
  console.log(`Authorized ${origin}.`);
} finally { await unlink(temporary).catch(() => undefined); }
