import { getBroadcastAthleteOverlayFeed } from "@/lib/broadcast-athlete-overlay";
import { platformFailure, platformSuccess } from "@/lib/platform-api-response";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ eventId: string }> }) {
  try {
    const { eventId } = await params;
    const feed = await getBroadcastAthleteOverlayFeed(eventId);
    if (!feed) return platformFailure("BROADCAST_OVERLAY_NOT_FOUND", "Broadcast athlete overlay is unavailable.", 404);
    return platformSuccess(feed, {
      eventId,
      lastUpdatedAt: feed.updatedAt,
      source: "timing-provider",
      provider: "FEIBOT",
      isStale: false,
      cacheSeconds: 0,
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return platformFailure(
      "BROADCAST_OVERLAY_UNAVAILABLE",
      error instanceof Error ? error.message : "Unable to load broadcast athlete overlay.",
      503,
    );
  }
}
