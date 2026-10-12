import { apiFailure, apiSuccess } from "@/lib/api-response";
import { getEvents } from "@/lib/raceupshot-repository";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const events = await getEvents({ includeUnpublished: true });
    return apiSuccess({
      worker: "raceupshot",
      status: "healthy",
      storage: "RACEUPSHOT KV",
      eventCount: events.length,
      checkedAt: new Date().toISOString(),
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return apiFailure(error instanceof Error ? error.message : "Health check failed", 503);
  }
}
