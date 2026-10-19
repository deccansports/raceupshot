import { describe, expect, it } from 'vitest';
import { assertVolunteerBikeWaiverAvailable, effectiveVolunteerWaiverVerifiedAt, resetVolunteerWaiverCheckIn } from '../lib/volunteer-check-in-state';
import { applyWaiverAsCheckIn, applyWaiverResetHistory, registrationWaiverVerifiedAt, volunteerWaiverOtpVariables } from '../lib/volunteer-operations';
import type { VolunteerOperationLog } from '../lib/volunteer-management';
import { signedWaiverConfirmationEmail } from '../lib/waiver-confirmation-email';

describe('volunteer waiver check-in', () => {
  it('supplies the case-sensitive athlete name and OTP template parameters', () => {
    expect(volunteerWaiverOtpVariables(' Asha Runner ', '012345')).toEqual({
      OTP: '012345',
      NAME: 'Asha Runner',
    });
  });

  it('resets the waiver and check-in together for an administrator', () => {
    expect(resetVolunteerWaiverCheckIn({
      waiverVerifiedAt: '2026-10-09T10:00:00.000Z',
      waiverResetAt: null,
      emailOtpVerifiedAt: '2026-10-09T10:00:00.000Z',
      checkedInAt: '2026-10-09T10:00:00.000Z',
      updatedAt: '2026-10-09T10:00:00.000Z',
      updatedBy: 'First Volunteer',
    }, '2026-10-09T10:05:00.000Z', 'admin@example.com')).toEqual({
      waiverVerifiedAt: null,
      waiverResetAt: '2026-10-09T10:05:00.000Z',
      emailOtpVerifiedAt: null,
      checkedInAt: null,
      updatedAt: '2026-10-09T10:05:00.000Z',
      updatedBy: 'admin@example.com',
    });
  });

  it('allows an administrator to reset a roster-only signed waiver', () => {
    expect(resetVolunteerWaiverCheckIn({
      waiverVerifiedAt: null, waiverResetAt: null, emailOtpVerifiedAt: null, checkedInAt: null,
      updatedAt: null, updatedBy: null,
    }, '2026-10-09T10:05:00.000Z', 'admin@example.com', true)).toMatchObject({
      waiverVerifiedAt: null, waiverResetAt: '2026-10-09T10:05:00.000Z', updatedBy: 'admin@example.com',
    });
  });

  it('does not resurrect a reset waiver from legacy roster aliases', () => {
    expect(registrationWaiverVerifiedAt({
      waiverStatus: null,
      waiverSignedAt: null,
      waiverVerifiedAt: null,
      waiver_status: 'signed',
      waiverAcceptedAt: '2026-10-09T10:00:00.000Z',
    })).toBeNull();
  });

  it('accepts a newly signed waiver after a prior reset marker is cleared', () => {
    expect(registrationWaiverVerifiedAt({
      waiverResetAt: null,
      waiverStatus: 'SIGNED',
      waiverSignedAt: '2026-10-09T11:00:00.000Z',
      waiverVerifiedAt: '2026-10-09T11:00:00.000Z',
      waiverAuditId: 'audit-1',
      waiverDocumentKey: 'signed-waivers/event/athlete/audit-1.pdf',
    })).toBe('2026-10-09T11:00:00.000Z');
  });

  it('does not accept a waiver status label without OTP verification evidence', () => {
    expect(registrationWaiverVerifiedAt({ waiverStatus: 'VERIFIED' })).toBeNull();
    expect(registrationWaiverVerifiedAt({ waiver_status: 'SIGNED' })).toBeNull();
    expect(registrationWaiverVerifiedAt({ waiverVerifiedAt: 'VERIFIED' })).toBeNull();
  });

  it('blocks bike check-in until a required waiver is signed without changing waiver state', () => {
    const unsigned = { waiverVerifiedAt: null, waiverResetAt: null };
    expect(() => assertVolunteerBikeWaiverAvailable(unsigned, true, null)).toThrow('must sign and verify');
    expect(unsigned).toEqual({ waiverVerifiedAt: null, waiverResetAt: null });
    expect(() => assertVolunteerBikeWaiverAvailable(unsigned, false, null)).not.toThrow();
  });

  it('does not trust an operational waiver timestamp without its OTP timestamp', () => {
    const incomplete = { waiverVerifiedAt: '2026-10-09T10:10:00.000Z', emailOtpVerifiedAt: null, waiverResetAt: null };
    expect(effectiveVolunteerWaiverVerifiedAt(incomplete)).toBeNull();
    expect(() => assertVolunteerBikeWaiverAvailable(incomplete, true)).toThrow('must sign and verify');
  });

  it('treats a verified waiver as completed check-in', () => {
    const signedAt = '2026-10-17T12:00:00.000Z';
    expect(applyWaiverAsCheckIn({
      waiverVerifiedAt: signedAt, waiverResetAt: null, emailOtpVerifiedAt: signedAt, checkedInAt: null,
      bikeCheckedInAt: null, bikeCheckedOutAt: null, helmetChecked: false, bikeRack: null,
      medalIssuedAt: null, foodIssuedAt: null, lockerNumber: null, updatedAt: signedAt, updatedBy: 'Volunteer',
    })).toMatchObject({ waiverVerifiedAt: signedAt, checkedInAt: signedAt });
  });

  it('does not revive waiver check-in after an administrator reset', () => {
    expect(applyWaiverAsCheckIn({
      waiverVerifiedAt: null, waiverResetAt: '2026-10-17T12:05:00.000Z', emailOtpVerifiedAt: null, checkedInAt: null,
      bikeCheckedInAt: null, bikeCheckedOutAt: null, helmetChecked: false, bikeRack: null,
      medalIssuedAt: null, foodIssuedAt: null, lockerNumber: null, updatedAt: null, updatedBy: null,
    }, '2026-10-17T12:00:00.000Z')).toMatchObject({ waiverVerifiedAt: null, checkedInAt: null });
  });

  it('accepts current waiver evidence but rejects evidence invalidated by a later reset', () => {
    const active = { waiverVerifiedAt: '2026-10-09T10:10:00.000Z', emailOtpVerifiedAt: '2026-10-09T10:10:00.000Z', waiverResetAt: null };
    expect(() => assertVolunteerBikeWaiverAvailable(active, true)).not.toThrow();
    const reset = { waiverVerifiedAt: null, waiverResetAt: '2026-10-09T10:05:00.000Z' };
    expect(effectiveVolunteerWaiverVerifiedAt(reset, '2026-10-09T10:00:00.000Z')).toBeNull();
    expect(() => assertVolunteerBikeWaiverAvailable(reset, true, '2026-10-09T10:00:00.000Z')).toThrow('must sign and verify');
    expect(effectiveVolunteerWaiverVerifiedAt(reset, '2026-10-09T10:10:00.000Z')).toBe('2026-10-09T10:10:00.000Z');
  });

  it('treats a legacy recall as a waiver reset until a later verification', () => {
    const base = {
      waiverVerifiedAt: '2026-10-09T10:00:00.000Z', waiverResetAt: null,
      emailOtpVerifiedAt: '2026-10-09T10:00:00.000Z', checkedInAt: '2026-10-09T10:00:00.000Z',
      bikeCheckedInAt: null, bikeCheckedOutAt: null, helmetChecked: false, bikeRack: null,
      medalIssuedAt: null, foodIssuedAt: null, lockerNumber: null, updatedAt: null, updatedBy: null,
    };
    const operation = (action: string, capturedAt: string): VolunteerOperationLog => ({
      id: `${action}-${capturedAt}`, eventId: 'event-1', eventName: 'Race', participantUid: 'athlete-1',
      bib: '101', athleteName: 'Runner', volunteerId: 'volunteer-1', volunteerName: 'Volunteer',
      action, capturedAt, status: 'CONFIRMED',
    });
    const reset = applyWaiverResetHistory({ 'athlete-1': base }, [operation('CHECK_IN_REVERSE', '2026-10-09T10:05:00.000Z')]);
    expect(reset['athlete-1']).toMatchObject({ waiverVerifiedAt: null, waiverResetAt: '2026-10-09T10:05:00.000Z', emailOtpVerifiedAt: null, checkedInAt: null });

    const signedAgain = applyWaiverResetHistory({ 'athlete-1': base }, [
      operation('CHECK_IN_REVERSE', '2026-10-09T10:05:00.000Z'),
      operation('WAIVER_VERIFY', '2026-10-09T10:10:00.000Z'),
    ]);
    expect(signedAgain['athlete-1'].waiverVerifiedAt).toBe('2026-10-09T10:00:00.000Z');
  });

  it('renders a check-in confirmation without claiming an absent attachment', () => {
    const html = signedWaiverConfirmationEmail({
      athleteName: 'Asha Runner', eventName: 'Race', category: 'Sprint', eventDate: '2026-10-10',
      bib: '101', signedAt: '2026-10-09T10:00:00.000Z', attachmentIncluded: false,
    });
    expect(html).toContain('Asha Runner');
    expect(html).not.toContain('PDF is attached');
  });
});
