import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(
  new URL('./useCanonicalChangeStream.ts', import.meta.url),
  'utf8',
);

test('canonical participant changes refresh event athlete queries across identity aliases', () => {
  assert.match(
    source,
    /queryKey\[1\] === 'athlete-detail' && queryKey\[2\] === eventId[\s\S]*?return true/,
  );
  assert.match(
    source,
    /queryKey\[0\] === 'canonical-live' && queryKey\[1\] === eventId && queryKey\[3\] === 'athlete'/,
  );
});
