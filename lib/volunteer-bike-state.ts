export interface ResettableVolunteerBikeState {
  bikeCheckedInAt: string | null;
  bikeCheckedOutAt: string | null;
  helmetChecked: boolean;
  bikeRack: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
  assignedChipCodeAtCheckout?: string | null;
  returnedChipCode?: string | null;
  returnedChipFullEpc?: string | null;
  chipReturnStatus?: string;
  chipReturnMethod?: string | null;
  chipReturnReason?: string | null;
  chipReturnedAt?: string | null;
  bikeCheckoutTransactionId?: string | null;
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
    ...(Object.prototype.hasOwnProperty.call(state, 'assignedChipCodeAtCheckout') ? {
      assignedChipCodeAtCheckout: null,
      returnedChipCode: null,
      returnedChipFullEpc: null,
      chipReturnStatus: 'PENDING_RETURN',
      chipReturnMethod: null,
      chipReturnReason: null,
      chipReturnedAt: null,
      bikeCheckoutTransactionId: null,
    } : {}),
    updatedAt: capturedAt,
    updatedBy: adminName,
  };
}
