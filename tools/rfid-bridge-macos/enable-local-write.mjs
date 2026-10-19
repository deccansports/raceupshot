import { spawnSync } from 'node:child_process';
import { userInfo } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'darwin') throw new Error('This setup is macOS-only.');
if (process.argv[2] !== '--accept-physical-write-validation') throw new Error('Run only after a same-TID EPC write and USB reconnect test has physically passed.');
const account = userInfo().username;
const signingSecret = process.env.RACEUPSHOT_RFID_SIGNING_SECRET || '';
if (signingSecret.length < 32) throw new Error('Provide the same 32+ character RACEUPSHOT_RFID_SIGNING_SECRET that is configured as the Worker secret. It will be stored in Keychain and not printed.');
const probe = join(dirname(fileURLToPath(import.meta.url)), 'bin', 'raceupshot-rfid-hid-probe');
const scan = spawnSync(probe, ['--status-json'], { encoding: 'utf8', timeout: 15000 });
const resultLine = scan.stdout?.split('\n').find((line) => line.startsWith('RACEUPSHOT_STATUS_JSON:'));
let reader;
try { reader = JSON.parse(resultLine?.slice('RACEUPSHOT_STATUS_JSON:'.length) || '{}'); } catch { /* Invalid native status. */ }
if (scan.status !== 0 || reader?.state !== 'CONNECTED' || reader?.availableReaders !== 1) throw new Error('Connect exactly one RU5600 reader first. No Keychain setting was changed.');
const saved = spawnSync('/usr/bin/security', ['add-generic-password', '-a', account, '-s', 'com.raceupshot.rfid.bridge.write-validated', '-w', 'PHYSICAL_ACCEPTANCE_PASSED', '-U'], { encoding: 'utf8', timeout: 5000 });
if (saved.status !== 0) throw new Error('Could not save the physical-validation marker in Keychain.');
const keySaved = spawnSync('/usr/bin/security', ['add-generic-password', '-a', account, '-s', 'com.raceupshot.rfid.bridge.signing', '-w', signingSecret, '-U'], { encoding: 'utf8', timeout: 5000 });
if (keySaved.status !== 0) throw new Error('Could not save the RFID signing key in Keychain.');
console.log('Local RFID writing enabled on this Mac. Restart the Race Upshot RFID bridge.');
