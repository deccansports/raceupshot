import { platformFailure, platformSuccess } from "@/lib/platform-api-response";
import { participantViewerFromRequest } from "@/lib/participant-viewer";
import { rankLiveLeaderboardParticipants } from "@/lib/live-leaderboard";
import {
  getPlatformEvent,
  getPublicLiveParticipants,
  getPublicResultParticipants,
} from "@/lib/platform-repository";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ eventId: string }> }) {
  try {
    const { eventId } = await params;
    const event = await getPlatformEvent(eventId);
    if (!event) return platformFailure("EVENT_NOT_FOUND", "Event not found", 404);
    if (!event.liveSettings.leaderboardEnabled) {
      return platformFailure("LEADERBOARD_DISABLED", "Leaderboard is disabled for this event", 403);
    }
    const viewer = await participantViewerFromRequest(request);
    // Use the same canonical participant read as the live participant/search
    // endpoint. The older leaderboard helper can retain an empty legacy board
    // even when the canonical participant snapshot is already available.
    const useLiveTiming = event.section === "LIVE" || event.liveSettings.liveTrackingEnabled;
    const read = useLiveTiming
      ? await getPublicLiveParticipants(event.eventId, viewer)
      : await getPublicResultParticipants(event.eventId, viewer);
    const rows = useLiveTiming
      ? rankLiveLeaderboardParticipants(read?.data ?? [])
      : (read?.data ?? [])
        .filter((participant) => participant.overallRank !== undefined)
        .sort((left, right) => (left.overallRank ?? Number.MAX_SAFE_INTEGER) - (right.overallRank ?? Number.MAX_SAFE_INTEGER));
    return read
      ? platformSuccess(rows, { ...read, eventId: event.eventId, cacheSeconds: 0 }, {
          headers: { "cache-control": viewer ? "private, no-store" : "public, no-store" },
        })
      : platformFailure("LEADERBOARD_NOT_FOUND", "Leaderboard is not available", 404);
  } catch (error) {
    return platformFailure("LEADERBOARD_UNAVAILABLE", error instanceof Error ? error.message : "Unable to load leaderboard", 503);
  }
}
