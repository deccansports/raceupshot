import { platformFailure, platformSuccess } from "@/lib/platform-api-response";
import { participantViewerFromRequest } from "@/lib/participant-viewer";
import {
  getPlatformEvent,
  getPublicLiveParticipants,
  getPublicResultParticipants,
  searchPublicLiveParticipants,
} from "@/lib/platform-repository";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ eventId: string }> }) {
  try {
    const { eventId } = await params;
    const event = await getPlatformEvent(eventId);
    if (!event) return platformFailure("EVENT_NOT_FOUND", "Event not found", 404);
    // Operations can deliberately keep canonical live timing active for a
    // completed/test event. In that case search/watchlists must use the same
    // race-day overlay as athlete detail instead of switching to final results.
    const resultsMode = event.section === "PAST" && !event.liveSettings.liveTrackingEnabled;
    const discoveryEnabled = resultsMode
      ? event.mobileSettings.resultsEnabled && event.mobileSettings.athleteSearchEnabled
      : event.liveSettings.liveTrackingEnabled
        && event.liveSettings.publicLiveTrackingEnabled
        && event.liveSettings.athleteSearchEnabled;
    if (!discoveryEnabled) {
      return platformSuccess([], { eventId: event.eventId, cacheSeconds: 5 });
    }
    const viewer = await participantViewerFromRequest(request);
    const query = new URL(request.url).searchParams.get("q")?.trim().toLowerCase() ?? "";
    const read = resultsMode
      ? await getPublicResultParticipants(event.eventId, viewer)
      : query ? await searchPublicLiveParticipants(event.eventId, query, viewer) : await getPublicLiveParticipants(event.eventId, viewer);
    if (!read) return platformFailure("PARTICIPANTS_NOT_FOUND", "Participants are not available", 404);
    const rows = query
      ? read.data.filter((participant) =>
          (participant.visibility === "PUBLIC" || Boolean(viewer && participant.bib))
          && (participant.displayName.toLowerCase().includes(query)
            || participant.bib.toLowerCase() === query))
      : read.data;
    return platformSuccess(rows.slice(0, query ? 50 : 250), {
      ...read,
      eventId: event.eventId,
      cacheSeconds: 0,
    }, {
      headers: { "cache-control": viewer ? "private, no-store" : "public, no-store" },
    });
  } catch (error) {
    return platformFailure("PARTICIPANTS_UNAVAILABLE", error instanceof Error ? error.message : "Unable to load participants", 503);
  }
}
