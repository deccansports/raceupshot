import { apiFailure, apiSuccess } from "@/lib/api-response";
import { participantViewerFromRequest } from "@/lib/participant-viewer";
import { getPublicResultParticipants, liveParticipantToAthlete } from "@/lib/platform-repository";
import { getResults } from "@/lib/raceupshot-repository";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ eventSlug: string }> }) {
  try {
    const { eventSlug } = await params;
    const result = await getResults(eventSlug);
    if (!result.event) return apiFailure("Event not found", 404);
    const viewer = await participantViewerFromRequest(request);
    const read = await getPublicResultParticipants(result.event.id, viewer);
    const athletes = read?.data.map((participant) => liveParticipantToAthlete(participant, result.event!)) ?? [];
    return apiSuccess({ event: result.event, athletes }, {
      headers: { "cache-control": viewer ? "private, no-store" : "public, max-age=30, s-maxage=30" },
    });
  } catch (error) {
    return apiFailure(error instanceof Error ? error.message : "Unable to load results", 503);
  }
}
