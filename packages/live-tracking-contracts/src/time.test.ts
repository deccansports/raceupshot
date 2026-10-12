import assert from 'node:assert/strict';
import test from 'node:test';

import { formatEventLocalTime, normalizeTimestampUtc } from './time.ts';

test('formats an absolute UTC read in the event timezone without changing the instant', () => {
  assert.equal(normalizeTimestampUtc('2026-08-07T13:28:03.000Z', 'Asia/Kolkata'), '2026-08-07T13:28:03.000Z');
  assert.equal(formatEventLocalTime('2026-08-07T13:28:03.000Z', 'Asia/Kolkata'), '18:58:03');
});

test('does not add a second offset to provider timestamps that already include one', () => {
  assert.equal(normalizeTimestampUtc('2026-08-07T18:58:03+05:30', 'Asia/Kolkata'), '2026-08-07T13:28:03.000Z');
  assert.equal(formatEventLocalTime('2026-08-07T18:58:03+05:30', 'Asia/Kolkata'), '18:58:03');
});

test('interprets a naive provider timestamp in its declared event timezone', () => {
  assert.equal(normalizeTimestampUtc('2026-08-07T18:58:03', 'Asia/Kolkata'), '2026-08-07T13:28:03.000Z');
});

test('accepts Feibot Unix seconds and milliseconds', () => {
  const timestamp = Date.parse('2026-08-09T06:05:49.000Z');
  assert.equal(formatEventLocalTime(timestamp / 1000, 'Asia/Kolkata'), '11:35:49');
  assert.equal(formatEventLocalTime(timestamp, 'Asia/Kolkata'), '11:35:49');
  assert.equal(formatEventLocalTime(String(timestamp / 1000), 'Asia/Kolkata'), '11:35:49');
});
