import { platformFailure, platformSuccess } from "@/lib/platform-api-response";
import { getPlatformEvent } from "@/lib/platform-repository";
import { canonicalManifestUpdatedAt, getCanonicalLiveEvent } from "@/lib/canonical-live-tracking";

export const dynamic = "force-dynamic";

// A complete snapshot for mobile cold starts/recovery. Normal participant and
// leaderboard routes consume the exact same manifest, so no client-side merge is required.
export async function GET(_request: Request, { params }: { params: Promise<{ eventId: string }> }) {
  try {
    const { eventId } = await params;
    const event = await getPlatformEvent(eventId);
    if (!event) return platformFailure("EVENT_NOT_FOUND", "Event not found", 404);
    const canonical = await getCanonicalLiveEvent(event.eventId);
    if (!canonical) return platformFailure("CANONICAL_LIVE_DATA_NOT_READY", "A complete canonical live build is not available yet.", 404);
    return platformSuccess(canonical, {
      eventId: event.eventId,
      lastUpdatedAt: canonicalManifestUpdatedAt(canonical.manifest),
      source: "timing-provider",
      provider: canonical.manifest.provider === "FEIBOT" || canonical.manifest.provider === "feibot" ? "FEIBOT" : "RACE_UPSHOT",
      isStale: false,
      cacheSeconds: 0,
    }, { headers: { "cache-control": "public, no-store" } });
  } catch (error) {
    return platformFailure("CANONICAL_LIVE_DATA_UNAVAILABLE", error instanceof Error ? error.message : "Unable to load canonical live data", 503);
  }
}
