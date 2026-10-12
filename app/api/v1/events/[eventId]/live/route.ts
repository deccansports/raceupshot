import { platformFailure, platformSuccess } from "@/lib/platform-api-response";
import { getPlatformEvent } from "@/lib/platform-repository";
import { getCanonicalLiveSummary } from "@/lib/canonical-live-tracking";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ eventId: string }> }) {
  try {
    const { eventId } = await params;
    const event = await getPlatformEvent(eventId);
    if (!event) return platformFailure("EVENT_NOT_FOUND", "Event not found", 404);
    if (!event.liveSettings.liveTrackingEnabled || !event.liveSettings.publicLiveTrackingEnabled) {
      return platformSuccess({
        event,
        availability: {
          state: "SCHEDULED",
          message: "Live tracking is not available yet. This event has not started.",
        },
        summary: {
          participantCount: 0,
          onCourse: 0,
          finished: 0,
          lastUpdatedAt: null,
        },
      }, { eventId: event.eventId, cacheSeconds: 5 });
    }
    const summary = await getCanonicalLiveSummary(event.eventId);
    if (!summary) return platformFailure("LIVE_DATA_NOT_FOUND", "Live data is not available", 404);
    return platformSuccess({
      event,
      availability: {
        state: summary.participantCount ? "AVAILABLE" : "DATA_PENDING",
        message: summary.participantCount
          ? "Public race timing is available."
          : "Live tracking will appear when timing starts or athletes are made public.",
      },
      summary: {
        participantCount: summary.participantCount,
        onCourse: summary.onCourse,
        finished: summary.finished,
        lastUpdatedAt: summary.updatedAt,
      },
    }, { eventId: event.eventId, lastUpdatedAt: summary.updatedAt, source: "timing-provider", provider: "FEIBOT", isStale: false, cacheSeconds: 5 });
  } catch (error) {
    return platformFailure("LIVE_DATA_UNAVAILABLE", error instanceof Error ? error.message : "Unable to load live event", 503);
  }
}
