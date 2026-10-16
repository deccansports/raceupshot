import { selectBikeParticipants, selectTeamChipParticipants } from "./relay-bike";

export interface CounterParticipant {
  id: string;
  chipCode: string;
  registrationWaiverVerifiedAt: string | null;
  bib?: string;
  participationMode?: "INDIVIDUAL" | "RELAY";
  relayTeamId?: string | null;
  relayMemberRole?: string | null;
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
  const bikeParticipants = selectBikeParticipants(participants);
  const waivedBikeEntries = bikeParticipants.filter((participant) =>
    Boolean(hasCompletedWaiver(participant) && states[participant.id]?.bikeCheckedInAt)).length;
  const bikeTeamsWithCompletedWaiver = bikeParticipants.filter(hasCompletedWaiver).length;
  const bikesEverCheckedIn = bikeParticipants.filter((participant) => Boolean(states[participant.id]?.bikeCheckedInAt)).length;
  const bikesCheckedIn = bikeParticipants.filter((participant) => Boolean(states[participant.id]?.bikeCheckedInAt && !states[participant.id]?.bikeCheckedOutAt)).length;
  const bikesCheckedOut = bikeParticipants.filter((participant) => Boolean(states[participant.id]?.bikeCheckedOutAt)).length;
  const chipParticipants = selectTeamChipParticipants(participants);
  const hasTeamBikeEntry = (participant: T) => {
    const groupKey = participant.participationMode === "RELAY" ? (participant.relayTeamId || `bib:${participant.bib || ""}`) : null;
    return participants.some((member) => {
      if (!groupKey) return member.id === participant.id && Boolean(states[member.id]?.bikeCheckedInAt);
      const memberGroupKey = member.participationMode === "RELAY" ? (member.relayTeamId || `bib:${member.bib || ""}`) : null;
      return memberGroupKey === groupKey && Boolean(states[member.id]?.bikeCheckedInAt);
    });
  };
  const chipsAssigned = chipParticipants.filter((participant) => Boolean(participant.chipCode)).length;
  // Timing-chip assignment remains valid after bike checkout. The chip desk
  // therefore uses every recorded bike entry, not only bikes still onsite.
  const chipsAssignedToBikeEntries = chipParticipants.filter((participant) =>
    Boolean(participant.chipCode && hasTeamBikeEntry(participant))).length;
  return {
    totalAthletes,
    checkedInAthletes,
    remainingToCheckIn: Math.max(0, totalAthletes - checkedInAthletes),
    waiverCompletedAthletes,
    bikesEverCheckedIn,
    bikesCheckedIn,
    bikesCheckedOut,
    remainingToBikeCheckIn: Math.max(0, bikeTeamsWithCompletedWaiver - waivedBikeEntries),
    remainingToBikeCheckOut: bikesCheckedIn,
    chipAssignmentTargets: chipParticipants.length,
    chipsAssigned,
    remainingToAssign: Math.max(0, chipParticipants.length - chipsAssigned),
    chipsAssignedToBikeEntries,
    remainingToAssignFromBikeEntries: Math.max(0, bikesEverCheckedIn - chipsAssignedToBikeEntries),
  };
}
