import { platformFailure, platformSuccess } from "@/lib/platform-api-response";
import { participantViewerFromRequest } from "@/lib/participant-viewer";
import { getPlatformEvent, getPublicResultParticipant } from "@/lib/platform-repository";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ eventId: string; resultId: string }> },
) {
  try {
    const { eventId, resultId } = await params;
    const event = await getPlatformEvent(eventId);
    if (!event) return platformFailure("EVENT_NOT_FOUND", "Event not found", 404);
    const viewer = await participantViewerFromRequest(request);
    const read = await getPublicResultParticipant(event.eventId, resultId, viewer);
    if (!read || !["FINISHED", "DNF", "DNS", "DNQ", "DSQ", "OTL"].includes(read.data.raceStatus)) {
      return platformFailure("RESULT_NOT_FOUND", "Result was not found or is private", 404);
    }
    return platformSuccess(read.data, { ...read, eventId: event.eventId, cacheSeconds: viewer ? 0 : 30 }, {
      headers: viewer ? { "cache-control": "private, no-store" } : undefined,
    });
  } catch (error) {
    return platformFailure("RESULT_UNAVAILABLE", error instanceof Error ? error.message : "Unable to load result", 503);
  }
}
