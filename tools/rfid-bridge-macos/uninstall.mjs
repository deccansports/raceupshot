import { spawnSync } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { homedir, userInfo } from 'node:os';
import { join } from 'node:path';

if (process.platform !== 'darwin') throw new Error('This uninstaller is macOS-only.');
if (!process.argv.includes('--confirm-raceupshot-rfid-uninstall')) throw new Error('Re-run with --confirm-raceupshot-rfid-uninstall. This removes only the Race Upshot local bridge, its pairings and Keychain entries.');
const uid = process.getuid();
const account = userInfo().username;
const plist = join(homedir(), 'Library', 'LaunchAgents', 'com.raceupshot.rfid-bridge.plist');
spawnSync('/bin/launchctl', ['bootout', `gui/${uid}/com.raceupshot.rfid-bridge`], { encoding: 'utf8', timeout: 10000 });
await rm(plist, { force: true });
await rm(join(homedir(), 'Library', 'Application Support', 'Race Upshot', 'RFID Encoder'), { recursive: true, force: true });
for (const service of ['com.raceupshot.rfid.bridge.pairing', 'com.raceupshot.rfid.bridge.signing', 'com.raceupshot.rfid.bridge.write-validated']) spawnSync('/usr/bin/security', ['delete-generic-password', '-a', account, '-s', service], { encoding: 'utf8', timeout: 5000 });
console.log('Race Upshot RFID bridge uninstalled. BERGMAN services and data were not touched.');
