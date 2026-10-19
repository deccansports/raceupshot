import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAX_CONSECUTIVE_TRANSPORT_FAILURES,
  TRANSPORT_FAILURE_COOLDOWN_MS,
  nextSocketReconnectDecision,
} from './socketReconnectPolicy';

test('retries briefly before entering bounded HTTP fallback cooldown', () => {
  assert.deepEqual(nextSocketReconnectDecision(0, 1_000), {
    kind: 'retry', attempts: 1, delayMs: 1_000,
  });
  assert.deepEqual(nextSocketReconnectDecision(1, 1_000), {
    kind: 'retry', attempts: 2, delayMs: 2_000,
  });
  assert.deepEqual(
    nextSocketReconnectDecision(MAX_CONSECUTIVE_TRANSPORT_FAILURES - 1, 1_000),
    {
      kind: 'cooldown', attempts: MAX_CONSECUTIVE_TRANSPORT_FAILURES,
      delayMs: TRANSPORT_FAILURE_COOLDOWN_MS,
      until: 1_000 + TRANSPORT_FAILURE_COOLDOWN_MS,
    },
  );
});

test('a failed cooldown probe returns directly to cooldown', () => {
  assert.equal(nextSocketReconnectDecision(0, 5_000, true).kind, 'cooldown');
});
