import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chmod, readFile, rename, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'darwin') throw new Error('This updater is macOS-only.');
const here = dirname(fileURLToPath(import.meta.url));
const launchAgent = join(homedir(), 'Library', 'LaunchAgents', 'com.raceupshot.rfid-bridge.plist');
const binary = join(here, 'bin', 'raceupshot-rfid-hid-probe');
const temporary = `${binary}.new-${process.pid}`;
if (!existsSync(launchAgent)) throw new Error('Race Upshot RFID bridge is not installed. Run setup.mjs.');
const plist = await readFile(launchAgent, 'utf8');
if (!plist.includes('<key>Label</key><string>com.raceupshot.rfid-bridge</string>') || !plist.includes(join(here, 'bridge.mjs'))) throw new Error('Installed LaunchAgent does not point to this Race Upshot checkout. No update was made.');
const run = (command, args) => { const result = spawnSync(command, args, { encoding: 'utf8', timeout: 60000 }); if (result.status !== 0) throw new Error(`${command} failed: ${(result.stderr || result.stdout || '').slice(0, 600)}`); };
try {
  run('clang', ['-Wall', '-Wextra', '-Werror', '-O2', '-framework', 'IOKit', '-framework', 'CoreFoundation', join(here, 'hid_probe.c'), '-o', temporary]);
  run(temporary, ['--self-test']);
  await chmod(temporary, 0o700);
  await rename(temporary, binary);
  run('/bin/launchctl', ['kickstart', '-k', `gui/${process.getuid()}/com.raceupshot.rfid-bridge`]);
  console.log('Race Upshot RFID bridge source and native probe updated; existing Keychain secrets, pairings and origin allowlist were preserved.');
} finally { await rm(temporary, { force: true }); }
