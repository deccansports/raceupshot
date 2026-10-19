import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { userInfo } from 'node:os';

if (process.platform !== 'darwin') throw new Error('Pairing-code rotation is macOS-only.');
const code = randomBytes(24).toString('base64url');
const account = userInfo().username;
const update = spawnSync('/usr/bin/security', ['add-generic-password', '-a', account, '-s', 'com.raceupshot.rfid.bridge.pairing', '-w', code, '-U'], { encoding: 'utf8', timeout: 10000 });
if (update.status !== 0) throw new Error(`Could not rotate the Keychain pairing code: ${(update.stderr || '').trim()}`);
const restart = spawnSync('/bin/launchctl', ['kickstart', '-k', `gui/${process.getuid()}/com.raceupshot.rfid-bridge`], { encoding: 'utf8', timeout: 10000 });
if (restart.status !== 0) throw new Error(`Pairing code rotated, but bridge restart failed: ${(restart.stderr || '').trim()}`);
console.log('Pairing code rotated and bridge restarted. Retrieve the new code privately from Keychain.');
