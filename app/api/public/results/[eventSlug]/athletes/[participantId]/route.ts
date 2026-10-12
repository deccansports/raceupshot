import { apiFailure, apiSuccess } from "@/lib/api-response";
import { participantViewerFromRequest } from "@/lib/participant-viewer";
import { getPublicResultParticipant, liveParticipantToAthlete } from "@/lib/platform-repository";
import { getResults } from "@/lib/raceupshot-repository";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ eventSlug: string; participantId: string }> },
) {
  try {
    const { eventSlug, participantId } = await params;
    const result = await getResults(eventSlug);
    if (!result.event) return apiFailure("Event not found", 404);
    const viewer = await participantViewerFromRequest(request);
    const read = await getPublicResultParticipant(result.event.id, participantId, viewer);
    if (!read) return apiFailure("Athlete result not found", 404);
    return apiSuccess({ event: result.event, athlete: liveParticipantToAthlete(read.data, result.event) }, {
      headers: { "cache-control": viewer ? "private, no-store" : "public, max-age=30, s-maxage=30" },
    });
  } catch (error) {
    return apiFailure(error instanceof Error ? error.message : "Unable to load athlete result", 503);
  }
}
