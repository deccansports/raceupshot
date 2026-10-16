export interface RelayBikeParticipant {
  id: string;
  bib?: string;
  participationMode?: "INDIVIDUAL" | "RELAY";
  relayTeamId?: string | null;
  relayMemberRole?: string | null;
}

export function isRelayCyclistRole(role: string | null | undefined): boolean {
  const normalized = (role || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ");
  return ["cycling", "cyclist", "cycle", "bike", "biking"].includes(normalized);
}

export function relayBikeGroupKey(participant: RelayBikeParticipant): string | null {
  if (participant.participationMode !== "RELAY") return null;
  const teamId = participant.relayTeamId?.trim();
  if (teamId) return `team:${teamId}`;
  const bib = participant.bib?.trim();
  return bib ? `bib:${bib}` : null;
}

/** One bike lifecycle exists per relay team and is owned by its Cycling member. */
export function selectBikeParticipants<T extends RelayBikeParticipant>(participants: T[]): T[] {
  const selected: T[] = [];
  const relayGroups = new Map<string, T[]>();
  for (const participant of participants) {
    const groupKey = relayBikeGroupKey(participant);
    if (!groupKey) selected.push(participant);
    else relayGroups.set(groupKey, [...(relayGroups.get(groupKey) || []), participant]);
  }
  for (const members of relayGroups.values()) {
    selected.push(members.find((member) => isRelayCyclistRole(member.relayMemberRole)) || members[0]);
  }
  return selected;
}

export function selectTeamChipParticipants<T extends RelayBikeParticipant & { chipCode: string }>(participants: T[]): T[] {
  const selected: T[] = [];
  const relayGroups = new Map<string, T[]>();
  for (const participant of participants) {
    const groupKey = relayBikeGroupKey(participant);
    if (!groupKey) selected.push(participant);
    else relayGroups.set(groupKey, [...(relayGroups.get(groupKey) || []), participant]);
  }
  for (const members of relayGroups.values()) selected.push(members.find((member) => Boolean(member.chipCode)) || members[0]);
  return selected;
}
