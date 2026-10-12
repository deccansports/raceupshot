export interface CounterParticipant {
  id: string;
  chipCode: string;
  registrationWaiverVerifiedAt: string | null;
}

export interface CounterState {
  checkedInAt: string | null;
  waiverVerifiedAt: string | null;
  waiverResetAt?: string | null;
  bikeCheckedInAt: string | null;
  bikeCheckedOutAt: string | null;
}

export function calculateVolunteerOperationCounters<T extends CounterParticipant>(
  participants: T[],
  states: Record<string, CounterState | undefined>,
) {
  const totalAthletes = participants.length;
  const checkedInAthletes = participants.filter((participant) => Boolean(states[participant.id]?.checkedInAt)).length;
  const hasCompletedWaiver = (participant: T) => Boolean(
    states[participant.id]?.waiverVerifiedAt
      || (!states[participant.id]?.waiverResetAt && participant.registrationWaiverVerifiedAt)
      || states[participant.id]?.checkedInAt,
  );
  const waiverCompletedAthletes = participants.filter(hasCompletedWaiver).length;
  const waivedBikeEntries = participants.filter((participant) =>
    Boolean(hasCompletedWaiver(participant) && states[participant.id]?.bikeCheckedInAt)).length;
  const bikesEverCheckedIn = participants.filter((participant) => Boolean(states[participant.id]?.bikeCheckedInAt)).length;
  const bikesCheckedIn = participants.filter((participant) => Boolean(states[participant.id]?.bikeCheckedInAt && !states[participant.id]?.bikeCheckedOutAt)).length;
  const bikesCheckedOut = participants.filter((participant) => Boolean(states[participant.id]?.bikeCheckedOutAt)).length;
  const chipsAssigned = participants.filter((participant) => Boolean(participant.chipCode)).length;
  // Timing-chip assignment remains valid after bike checkout. The chip desk
  // therefore uses every recorded bike entry, not only bikes still onsite.
  const chipsAssignedToBikeEntries = participants.filter((participant) =>
    Boolean(participant.chipCode && states[participant.id]?.bikeCheckedInAt)).length;
  return {
    totalAthletes,
    checkedInAthletes,
    remainingToCheckIn: Math.max(0, totalAthletes - checkedInAthletes),
    waiverCompletedAthletes,
    bikesEverCheckedIn,
    bikesCheckedIn,
    bikesCheckedOut,
    remainingToBikeCheckIn: Math.max(0, waiverCompletedAthletes - waivedBikeEntries),
    remainingToBikeCheckOut: bikesCheckedIn,
    chipsAssigned,
    remainingToAssign: Math.max(0, totalAthletes - chipsAssigned),
    chipsAssignedToBikeEntries,
    remainingToAssignFromBikeEntries: Math.max(0, bikesEverCheckedIn - chipsAssignedToBikeEntries),
  };
}
