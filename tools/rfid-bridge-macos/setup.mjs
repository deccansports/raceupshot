import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { homedir, userInfo } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'darwin') throw new Error('This installer is macOS-only.');
const here = dirname(fileURLToPath(import.meta.url));
const binaryDir = join(here, 'bin');
const binary = join(binaryDir, 'raceupshot-rfid-hid-probe');
const launchAgent = join(homedir(), 'Library', 'LaunchAgents', 'com.raceupshot.rfid-bridge.plist');
const logDir = join(homedir(), 'Library', 'Application Support', 'Race Upshot', 'RFID Encoder');
const account = userInfo().username;
const origins = process.env.RACEUPSHOT_RFID_ALLOWED_ORIGINS || 'https://raceupshot.com,https://www.raceupshot.com,https://raceupshot.hidden-limit-41e6.workers.dev,http://localhost:3001';
if (origins.split(',').some((origin) => !/^https:\/\/[^/]+$/.test(origin.trim()) && !/^http:\/\/localhost:\d+$/.test(origin.trim()))) throw new Error('Set trusted, comma-separated RACEUPSHOT_RFID_ALLOWED_ORIGINS.');
if (existsSync(launchAgent)) throw new Error(`LaunchAgent already exists at ${launchAgent}. Review it before reinstalling.`);

const run = (command, args) => {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 30000 });
  if (result.status !== 0) throw new Error(`${command} failed: ${(result.stderr || result.stdout || '').slice(0, 400)}`);
};
const xml = (value) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

await mkdir(binaryDir, { recursive: true });
run('clang', ['-Wall', '-Wextra', '-O2', '-framework', 'IOKit', '-framework', 'CoreFoundation', join(here, 'hid_probe.c'), '-o', binary]);
await chmod(binary, 0o700);
await mkdir(logDir, { recursive: true, mode: 0o700 });
const pairingCode = randomBytes(24).toString('base64url');
run('/usr/bin/security', ['add-generic-password', '-a', account, '-s', 'com.raceupshot.rfid.bridge.pairing', '-w', pairingCode, '-U']);

const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>com.raceupshot.rfid-bridge</string>
<key>ProgramArguments</key><array><string>${xml(process.execPath)}</string><string>${xml(join(here, 'bridge.mjs'))}</string></array>
<key>EnvironmentVariables</key><dict><key>RACEUPSHOT_RFID_ALLOWED_ORIGINS</key><string>${xml(origins)}</string><key>RACEUPSHOT_RFID_KEYCHAIN_ACCOUNT</key><string>${xml(account)}</string></dict>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>10</integer>
<key>StandardOutPath</key><string>${xml(join(logDir, 'bridge.log'))}</string>
<key>StandardErrorPath</key><string>${xml(join(logDir, 'bridge-error.log'))}</string>
</dict></plist>`;
await mkdir(dirname(launchAgent), { recursive: true });
await writeFile(launchAgent, plist, { mode: 0o600, flag: 'wx' });
run('/bin/launchctl', ['bootstrap', `gui/${process.getuid()}`, launchAgent]);
console.log(`Installed Race Upshot RFID auto-start bridge for ${origins}.`);
console.log('The permanent pairing secret was stored in macOS Keychain and was not displayed. Use automatic browser pairing in Race Upshot Admin.');
console.log('RFID reads and writes remain local; no RFID inventory is uploaded.');
