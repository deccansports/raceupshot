import { platformFailure, platformSuccess } from "@/lib/platform-api-response";
import { getPlatformEvent } from "@/lib/platform-repository";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ eventId: string }> }) {
  try {
    const { eventId } = await params;
    const event = await getPlatformEvent(eventId);
    const origin = new URL(request.url).origin;
    const absolute = (value?: string) => value?.startsWith("/") ? `${origin}${value}` : value;
    return event
      ? platformSuccess({
        ...event,
        rulesUrl: absolute(event.rulesUrl),
        athleteGuidebookUrl: absolute(event.athleteGuidebookUrl),
      }, { eventId: event.eventId, cacheSeconds: 30 })
      : platformFailure("EVENT_NOT_FOUND", "Event not found", 404);
  } catch (error) {
    return platformFailure("EVENT_UNAVAILABLE", error instanceof Error ? error.message : "Unable to load event", 503);
  }
}
