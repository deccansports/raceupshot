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
      }),
      getPublicLiveTimingConfiguration(eventId).catch(() => null),
    ]);
    return read
      ? platformSuccess({ ...read.data, timingConfiguration }, { ...read, eventId })
      : platformFailure("EVENT_NOT_FOUND", "Event not found", 404);
  } catch (error) {
    return platformFailure("COURSE_UNAVAILABLE", error instanceof Error ? error.message : "Unable to load course", 503);
  }
}
