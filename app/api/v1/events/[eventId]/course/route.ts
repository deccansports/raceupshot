import { platformFailure, platformSuccess } from "@/lib/platform-api-response";
import { getEventCourse } from "@/lib/platform-repository";
import { getPublicLiveTimingConfiguration } from "@/lib/live-tracking-hub-config";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ eventId: string }> }) {
  try {
    const { eventId } = await params;
    const search = new URL(request.url).searchParams;
    const [read, timingConfiguration] = await Promise.all([
      getEventCourse(eventId, {
        surface: search.get("surface") === "mobile" ? "mobile" : "web",
        category: search.get("category"),
        ticketId: search.get("ticketId"),
        contestId: search.get("contestId"),
        includeGeometry: search.get("geometry") !== "0",
      }),
      getPublicLiveTimingConfiguration(eventId).catch(() => null),
    ]);
    return read
      ? platformSuccess({ ...read.data, timingConfiguration }, {
          ...read,
          eventId,
          cacheSeconds: 0,
        }, {
          // Split visibility is an operational race-day control. Revalidate
          // immediately so a newly hidden checkpoint cannot remain in a
          // cached mobile/web course response.
          headers: { "cache-control": "public, max-age=0, s-maxage=5, must-revalidate" },
        })
      : platformFailure("EVENT_NOT_FOUND", "Event not found", 404);
  } catch (error) {
    return platformFailure("COURSE_UNAVAILABLE", error instanceof Error ? error.message : "Unable to load course", 503);
  }
}
