import { describe, expect, it } from 'vitest';
import { signedWaiverConfirmationEmail } from '../lib/waiver-confirmation-email';

describe('signed waiver confirmation email', () => {
  it('renders Race Upshot confirmation content and escapes athlete values', () => {
    const html = signedWaiverConfirmationEmail({
      athleteName: '<Test Athlete>', eventName: 'Ozar & Hills', category: 'Olympic',
      eventDate: '2026-11-08', bib: '101', signedAt: '2026-10-09T10:00:00.000Z',
    });
    expect(html).toContain('Race Upshot');
    expect(html).toContain('OTP-verified signed waiver PDF is attached');
    expect(html).toContain('&lt;Test Athlete&gt;');
    expect(html).toContain('Ozar &amp; Hills');
    expect(html).not.toContain('<Test Athlete>');
  });
});
