import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const run = (args) => spawnSync(join(here, 'bin', 'raceupshot-rfid-hid-probe'), args, { encoding: 'utf8', timeout: 45000 });
const status = run(['--status-json']);
process.stdout.write(status.stdout || '');
if (status.status !== 0) process.exit(status.status || 1);
if (process.argv.includes('--read-one')) {
  const read = run(['--scan-json']);
  process.stdout.write(read.stdout || '');
  if (read.status !== 0) process.exit(read.status || 1);
}
