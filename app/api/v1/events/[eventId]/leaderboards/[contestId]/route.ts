import { platformFailure, platformSuccess } from "@/lib/platform-api-response";
import { participantViewerFromRequest } from "@/lib/participant-viewer";
import { getPlatformEvent, getPublicLeaderboard } from "@/lib/platform-repository";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ eventId: string; contestId: string }> },
) {
  try {
    const { eventId, contestId } = await params;
    const event = await getPlatformEvent(eventId);
    if (!event) return platformFailure("EVENT_NOT_FOUND", "Event not found", 404);
    if (!event.liveSettings.leaderboardEnabled) {
      return platformFailure("LEADERBOARD_DISABLED", "Leaderboard is disabled for this event", 403);
    }
    const viewer = await participantViewerFromRequest(request);
    const read = await getPublicLeaderboard(event.eventId, contestId, viewer);
    return read
      ? platformSuccess(read.data, { ...read, eventId: event.eventId, cacheSeconds: 0 }, {
          headers: { "cache-control": viewer ? "private, no-store" : "public, no-store" },
        })
      : platformFailure("LEADERBOARD_NOT_FOUND", "Leaderboard is not available", 404);
  } catch (error) {
    return platformFailure("LEADERBOARD_UNAVAILABLE", error instanceof Error ? error.message : "Unable to load leaderboard", 503);
  }
}
