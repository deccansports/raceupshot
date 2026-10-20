import type { LiveParticipant } from "@/packages/contracts/src";
import type { LiveTrackingHubConfig } from "./live-tracking-hub-config";
import { acceptedConfiguredTerminalSplit, resolveConfiguredFinishers } from "./live-leaderboard";

/** Repair stale projections only from complete, accepted logical-course evidence. */
export function reconcileProvisionalParticipants(
  participants: LiveParticipant[],
  config: Pick<LiveTrackingHubConfig, "splits" | "contestMappings">,
): LiveParticipant[] {
  return participants.map((participant) => {
    const mapped = config.contestMappings.find((mapping) => mapping.contestId === participant.contestId)?.providerContestUuid;
    const contest = mapped || participant.contestId;
    const sequence = config.splits.filter((split) =>
      !split.providerContestUuid || split.providerContestUuid === contest)
      .sort((a, b) => a.order - b.order);
    if (!sequence.length || sequence.filter((split) => split.isFinalRaceSplit).length !== 1
      || !sequence.at(-1)?.isFinalRaceSplit) return participant;
    let last = -1;
    const usedReads = new Set<LiveParticipant["splits"][number]>();
    for (const configured of sequence) {
      const read = acceptedConfiguredTerminalSplit(participant, [{ ...configured, isFinalRaceSplit: true }]);
      if (!read) {
        if (configured.requiredForProgression !== false || configured.isFinalRaceSplit) return participant;
        continue;
      }
      const ms = read.officialTimeMs ?? read.chipTimeMs ?? read.gunTimeMs;
      if (usedReads.has(read) || ms == null || !Number.isFinite(ms) || ms < last) return participant;
      usedReads.add(read);
      last = ms;
    }
    if (last <= 0) return participant;
    return resolveConfiguredFinishers([participant], sequence, { preserveDnf: true, decorateRanks: false })[0];
  });
}

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
