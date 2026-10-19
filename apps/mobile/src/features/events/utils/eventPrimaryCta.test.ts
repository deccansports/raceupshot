import { expect, test } from 'vitest';
import { getMobileEventPrimaryCta } from './eventPrimaryCta';

test('a past event never keeps a stale Live Tracking button', () => {
  expect(getMobileEventPrimaryCta({
    id: 'race-1', name: 'New Test', dateLabel: '10 Oct 2026',
    status: 'finished', isUpcoming: false,
    primaryCta: { type: 'LIVE', label: 'Live Tracking' },
    raw: { status: 'live' },
  })).toBe('DETAILS');
});
