import type { LiveParticipant } from "@/packages/contracts/src";
import type { LiveTrackingHubConfig } from "./live-tracking-hub-config";
import { resolveConfiguredFinishers } from "./live-leaderboard";

/** Both volunteer counters must use the same contest-scoped finish evidence. */
export function resolveVolunteerTimingState(participant: LiveParticipant, hub: LiveTrackingHubConfig) {
  const providerContest = hub.contestMappings.find((mapping) => mapping.contestId === participant.contestId)?.providerContestUuid ?? participant.contestId;
  const config = { ...hub, splits: hub.splits.filter((split) => !split.providerContestUuid || split.providerContestUuid === providerContest) };
  const [resolved] = resolveConfiguredFinishers([participant], config.splits, { preserveDnf: true, decorateRanks: false });
  return { participant: resolved, config };
}
