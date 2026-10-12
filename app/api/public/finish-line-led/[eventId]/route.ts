import { getFinishLineLedFeed } from "@/lib/finish-line-led";
import { platformFailure, platformSuccess } from "@/lib/platform-api-response";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ eventId: string }> }) {
  try {
    const { eventId } = await params;
    const feed = await getFinishLineLedFeed(eventId);
    if (!feed) return platformFailure("EVENT_NOT_FOUND", "Event not found", 404);
    return platformSuccess(feed, {
      source: "timing-provider",
      provider: "FEIBOT",
      lastUpdatedAt: feed.updatedAt,
      isStale: !feed.updatedAt || Date.now() - Date.parse(feed.updatedAt) > 60_000,
      cacheSeconds: 0,
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return platformFailure("FINISH_LINE_LED_UNAVAILABLE", error instanceof Error ? error.message : "Finish Line LED feed is unavailable", 503);
  }
}
