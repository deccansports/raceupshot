import { describe, expect, it } from 'vitest';
import { resolveMobileEventSection } from '../lib/mobile-event-section';

describe('mobile event section', () => {
  const start = '2026-10-10T16:30:00.000Z';
  const now = Date.parse('2026-10-12T04:00:00.000Z');

  it('moves a completed race to Past despite a stale manual Live selection', () => {
    expect(resolveMobileEventSection('COMPLETED', 'LIVE', start, null, now)).toBe('PAST');
  });
  it('expires a Live race after its end or one-day fallback window', () => {
    expect(resolveMobileEventSection('LIVE', 'LIVE', start, null, now)).toBe('PAST');
    expect(resolveMobileEventSection('LIVE', 'AUTO', start, '2026-10-13T16:30:00.000Z', now)).toBe('LIVE');
  });
  it('keeps a race Live within its window', () => {
    expect(resolveMobileEventSection('LIVE', 'AUTO', start, null, Date.parse('2026-10-10T20:00:00.000Z'))).toBe('LIVE');
  });
});
