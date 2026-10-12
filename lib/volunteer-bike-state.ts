export interface ResettableVolunteerBikeState {
  bikeCheckedInAt: string | null;
  bikeCheckedOutAt: string | null;
  helmetChecked: boolean;
  bikeRack: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
}

export function assertVolunteerBikeCheckInAvailable(state: Pick<ResettableVolunteerBikeState, 'bikeCheckedInAt'>): void {
  if (state.bikeCheckedInAt) {
    throw new Error('The bike has already been checked in for this event. An administrator must reset it before another bike check-in.');
  }
}

/** Clear the complete bike lifecycle. This is restricted to authenticated admins. */
export function resetVolunteerBikeCheckIn<T extends ResettableVolunteerBikeState>(
  state: T,
  capturedAt: string,
  adminName: string,
): T {
  if (!state.bikeCheckedInAt) throw new Error('The athlete has no bike check-in state to reset.');
  return {
    ...state,
    bikeCheckedInAt: null,
    bikeCheckedOutAt: null,
    helmetChecked: false,
    bikeRack: null,
    updatedAt: capturedAt,
    updatedBy: adminName,
  };
}
