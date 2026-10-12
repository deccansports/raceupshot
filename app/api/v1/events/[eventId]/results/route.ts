import { platformFailure, platformSuccess } from "@/lib/platform-api-response";
import { participantViewerFromRequest } from "@/lib/participant-viewer";
import { getPlatformEvent, getPublicResultParticipants } from "@/lib/platform-repository";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ eventId: string }> }) {
  try {
    const { eventId } = await params;
    const event = await getPlatformEvent(eventId);
    if (!event) return platformFailure("EVENT_NOT_FOUND", "Event not found", 404);
    if (!event.mobileSettings.resultsEnabled) {
      return platformFailure("RESULTS_DISABLED", "Results are not enabled for this event", 403);
    }
    const viewer = await participantViewerFromRequest(request);
    const read = await getPublicResultParticipants(event.eventId, viewer);
    if (!read) return platformFailure("RESULTS_NOT_FOUND", "Results are not available", 404);
    const results = read.data.filter((participant) =>
      ["FINISHED", "DNF", "DNS", "DNQ", "DSQ", "OTL"].includes(participant.raceStatus));
    return platformSuccess(results, { ...read, eventId: event.eventId, cacheSeconds: viewer ? 0 : 30 }, {
      headers: viewer ? { "cache-control": "private, no-store" } : undefined,
    });
  } catch (error) {
    return platformFailure("RESULTS_UNAVAILABLE", error instanceof Error ? error.message : "Unable to load results", 503);
  }
}
