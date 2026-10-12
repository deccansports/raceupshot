export interface ResettableVolunteerCheckInState {
  waiverVerifiedAt: string | null;
  waiverResetAt: string | null;
  emailOtpVerifiedAt: string | null;
  checkedInAt: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
}

type VolunteerWaiverState = Pick<ResettableVolunteerCheckInState, 'waiverVerifiedAt' | 'waiverResetAt'>;

/** Resolve waiver evidence without mutating counter state or reviving evidence invalidated by a later reset. */
export function effectiveVolunteerWaiverVerifiedAt(
  state: VolunteerWaiverState,
  registrationVerifiedAt?: string | null,
): string | null {
  const candidates = [state.waiverVerifiedAt, registrationVerifiedAt].filter((value): value is string => Boolean(value));
  if (!state.waiverResetAt) return candidates[0] ?? null;
  const resetAt = Date.parse(state.waiverResetAt);
  if (!Number.isFinite(resetAt)) return null;
  return candidates
    .filter((value) => {
      const verifiedAt = Date.parse(value);
      return Number.isFinite(verifiedAt) && verifiedAt > resetAt;
    })
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0] ?? null;
}

export function assertVolunteerBikeWaiverAvailable(
  state: VolunteerWaiverState,
  waiverRequired: boolean,
  registrationVerifiedAt?: string | null,
): void {
  if (waiverRequired && !effectiveVolunteerWaiverVerifiedAt(state, registrationVerifiedAt)) {
    throw new Error('The athlete must sign and verify the event waiver before bike check-in.');
  }
}

/** Complete exactly one registration. The caller must serialize writes (the event Durable Object does). */
export function completeRegistrationCheckIn<T extends ResettableVolunteerCheckInState>(
  current: T,
  input: { waiverRequired: boolean; registrationWaiverVerifiedAt?: string | null; capturedAt: string; volunteerName: string },
): T {
  if (input.waiverRequired && !effectiveVolunteerWaiverVerifiedAt(current, input.registrationWaiverVerifiedAt)) throw new Error('WAIVER SIGNATURE REQUIRED');
  if (current.checkedInAt) throw new Error('The registration is already checked in.');
  return { ...current, checkedInAt: input.capturedAt, updatedAt: input.capturedAt, updatedBy: input.volunteerName };
}

/** Reset the race-day waiver verification and check-in as one admin action. */
export function resetVolunteerWaiverCheckIn<T extends ResettableVolunteerCheckInState>(
  current: T,
  capturedAt: string,
  adminName: string,
  allowRosterOnlyWaiver = false,
): T {
  if (!allowRosterOnlyWaiver && !current.checkedInAt && !current.emailOtpVerifiedAt && !current.waiverVerifiedAt) {
    throw new Error('The athlete has no waiver or check-in state to reset.');
  }
  return {
    ...current,
    checkedInAt: null,
    emailOtpVerifiedAt: null,
    waiverVerifiedAt: null,
    waiverResetAt: capturedAt,
    updatedAt: capturedAt,
    updatedBy: adminName,
  };
}
