import { expect, it } from 'vitest';
import { volunteerBandIdentifier } from '../lib/volunteer-band-identifier';
it('accepts generic tags without prefix rules and preserves leading zeroes', () => {
  for (const code of ['1', '00001', 'ANY-TAG', 'outside/vendor/001', 'https://example.com/tag/001', 'tag with spaces']) {
    expect(volunteerBandIdentifier(code)).toBe(code.toUpperCase());
  }
});
it('decodes supported QR envelopes consistently', () => {
  expect(volunteerBandIdentifier('{"code":"00001"}')).toBe('00001');
  expect(volunteerBandIdentifier('https://example.com/?code=00001')).toBe('00001');
});
it('rejects empty, control-character and oversized tag values', () => {
  for (const code of ['', '   ', 'a\u0000b', 'a'.repeat(251)]) expect(() => volunteerBandIdentifier(code)).toThrow();
});
