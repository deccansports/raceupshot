import type { LiveParticipant } from "@/packages/contracts/src";

const RESULT_STATUSES = new Set(["FINISHED", "DNF", "DNS", "DNQ", "DSQ", "OTL"]);

export function resultParticipants(participants: LiveParticipant[]): LiveParticipant[] {
  return participants
    .filter((participant) => RESULT_STATUSES.has(participant.raceStatus))
    .sort((left, right) =>
      (left.overallRank ?? Number.MAX_SAFE_INTEGER) - (right.overallRank ?? Number.MAX_SAFE_INTEGER)
      || left.bib.localeCompare(right.bib));
}

export function shouldUseCanonicalResultFallback(
  currentResults: LiveParticipant[],
  source: "raceupshot" | "timing-provider" | "published-results",
): boolean {
  return currentResults.length === 0 && source !== "published-results";
}
