import { platformFailure, platformSuccess } from "@/lib/platform-api-response";
import { configuredCourseDistance } from '@/lib/course-distance';
import { participantViewerFromRequest } from "@/lib/participant-viewer";
import { getCanonicalLiveEvent } from "@/lib/canonical-live-tracking";
import { getPlatformEvent, getPublicLiveParticipant, getPublicResultParticipant } from "@/lib/platform-repository";
import { getLiveTrackingHubConfig, getPublicLiveTimingConfiguration } from "@/lib/live-tracking-hub-config";
import { resolveConfiguredFinishers } from "@/lib/live-leaderboard";
import type { LiveParticipant } from "@/packages/contracts/src";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ eventId: string; participantUid: string }> },
) {
  try {
    const { eventId, participantUid } = await params;
    const event = await getPlatformEvent(eventId);
    if (!event) return platformFailure("EVENT_NOT_FOUND", "Event not found", 404);
    const viewer = await participantViewerFromRequest(request);
    // Operations may keep live tracking enabled while testing a completed or
    // manually closed event. In that state canonical timing remains the
    // authority; the calendar section must not silently switch the athlete
    // modal to uploaded-results data.
    const useCanonicalLiveData =
      event.section !== "PAST" || event.liveSettings.liveTrackingEnabled;
    const readPromise = useCanonicalLiveData
      ? getPublicLiveParticipant(event.eventId, participantUid, viewer, event)
      : getPublicResultParticipant(event.eventId, participantUid, viewer, event);
    const timingConfigurationPromise = getPublicLiveTimingConfiguration(event.eventId).catch(() => null);
    const internalConfigurationPromise = useCanonicalLiveData
      ? getLiveTrackingHubConfig(event.eventId).catch(() => null)
      : Promise.resolve(null);
    const [read, timingConfiguration, internalConfiguration] = await Promise.all([
      readPromise,
      timingConfigurationPromise,
      internalConfigurationPromise,
    ]);
    if (!read) return platformFailure("PARTICIPANT_NOT_FOUND", "Participant was not found or is private", 404);
    let participant = useCanonicalLiveData
      ? resolveConfiguredFinishers(
          [read.data as LiveParticipant],
          timingConfiguration?.splits ?? [],
          {
            // Only the timing engine may reverse an automatic DNF after it
            // validates a late-arriving physical finish before the deadline.
            preserveDnf: true,
            decorateRanks: false,
          },
        )[0]
      : read.data as LiveParticipant;
    if (!participant) return platformFailure("PARTICIPANT_NOT_FOUND", "Participant was not found or is private", 404);
    // Active tracking remains a one-athlete canonical read. Only the single
    // terminal response may need event context to finalize ranks when an old
    // DNF overlay predates rank persistence; mobile freezes this snapshot once
    // FINISHED, so it is not part of the one-second polling path.
    if (
      useCanonicalLiveData
      && participant.raceStatus === "FINISHED"
      && (participant.overallRank == null || participant.splits.some((split) => split.rankAtSplit == null))
    ) {
      const canonical = await getCanonicalLiveEvent(event.eventId);
      const ranked = canonical
        ? resolveConfiguredFinishers(canonical.participants, timingConfiguration?.splits ?? [], {
            preserveDnf: true,
          }).find((row) => row.participantUid === participant.participantUid || row.bib === participant.bib)
        : undefined;
      if (ranked) {
        const rankedSplits = new Map(ranked.splits.map((split) => [split.splitId || split.name, split]));
        participant = {
          ...participant,
          overallRank: ranked.overallRank,
          overallRankTotal: ranked.overallRankTotal,
          genderRank: ranked.genderRank,
          genderRankTotal: ranked.genderRankTotal,
          ageGroupRank: ranked.ageGroupRank,
          ageGroupRankTotal: ranked.ageGroupRankTotal,
          splits: participant.splits.map((split) => ({
            ...split,
            rankAtSplit: split.rankAtSplit
              ?? rankedSplits.get(split.splitId || split.name)?.rankAtSplit,
          })),
        };
      }
    }
    // Completed events still need their saved Race Flow so athlete timelines
    // can display every official checkpoint alongside final/empty timing rows.
    const contestId = participant.contestId ?? "";
    const contestSplits = (contestId ? timingConfiguration?.splitsByContest?.[contestId] : undefined)
      ?? timingConfiguration?.splits
      ?? [];
    const contestLegs = (contestId ? timingConfiguration?.legsByContest?.[contestId] : undefined)
      ?? timingConfiguration?.legs
      ?? [];
    return platformSuccess({
      ...participant,
      timingConfiguration: timingConfiguration ? {
        ...timingConfiguration,
        legs: contestLegs,
        splits: contestSplits,
        totalDistanceKm: configuredCourseDistance(contestSplits, contestLegs),
      } : null,
      contestContext: timingConfiguration ? {
        contest: {
          id: contestId,
          uuid: contestId,
          contestUuid: contestId,
          name: participant.contestName,
          displayName: participant.contestName,
        },
        legs: contestLegs,
        splits: contestSplits,
      } : undefined,
    }, { ...read, eventId: event.eventId, cacheSeconds: 0 }, {
          // Live athlete timing must never sit behind the platform API's
          // default ten-second public cache. The selected mobile athlete polls
          // this endpoint once per second and must see a newly published
          // canonical split on its very next request.
          headers: { "cache-control": viewer ? "private, no-store" : "no-store" },
        });
  } catch (error) {
    return platformFailure("PARTICIPANT_UNAVAILABLE", error instanceof Error ? error.message : "Unable to load participant", 503);
  }
}
