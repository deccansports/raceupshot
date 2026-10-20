import type { LiveParticipant } from "@/packages/contracts/src";

const RESULT_STATUSES = new Set(["FINISHED", "DNF", "DNS", "DNQ", "DSQ", "OTL"]);

export function resultParticipants(participants: LiveParticipant[]): LiveParticipant[] {
  return participants.filter((participant) => RESULT_STATUSES.has(participant.raceStatus));
}

export function shouldUseCanonicalResultFallback(
  currentResults: LiveParticipant[],
  source: "raceupshot" | "timing-provider" | "published-results",
): boolean {
  return currentResults.length === 0 && source !== "published-results";
}
