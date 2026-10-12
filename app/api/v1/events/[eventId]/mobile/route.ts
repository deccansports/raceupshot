import { platformFailure, platformSuccess } from "@/lib/platform-api-response";
import { getPlatformEvent } from "@/lib/platform-repository";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ eventId: string }> }) {
  try {
    const { eventId } = await params;
    const event = await getPlatformEvent(eventId);
    if (!event || !event.mobileSettings.mobilePublished) {
      return platformFailure("EVENT_NOT_AVAILABLE_IN_APP", "Event is not published to the Race Upshot app", 404);
    }
    const origin = new URL(request.url).origin;
    const absolute = (value?: string) => value?.startsWith("/") ? `${origin}${value}` : value;
    return platformSuccess({
      ...event,
      rulesUrl: absolute(event.rulesUrl),
      athleteGuidebookUrl: absolute(event.athleteGuidebookUrl),
    }, { eventId: event.eventId, cacheSeconds: 0 }, {
      headers: { "cache-control": "public, max-age=0, s-maxage=5, must-revalidate" },
    });
  } catch (error) {
    return platformFailure("MOBILE_EVENT_UNAVAILABLE", error instanceof Error ? error.message : "Unable to load mobile event", 503);
  }
}
