import { canonicalManifestUpdatedAt, getCanonicalLiveEvent } from "@/lib/canonical-live-tracking";
import { getLiveTrackingHubConfig } from "@/lib/live-tracking-hub-config";
import { platformFailure, platformSuccess } from "@/lib/platform-api-response";
import { participantViewerFromRequest } from "@/lib/participant-viewer";
import { getPlatformEvent, getPublicResultParticipants, sanitizePublicParticipantSplits } from "@/lib/platform-repository";
import { reconcileProvisionalParticipants, resultParticipants, shouldUseCanonicalResultFallback } from "@/lib/provisional-results";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ eventId: string }> }) {
  try {
    const { eventId } = await params;
    const event = await getPlatformEvent(eventId);
    if (!event) return platformFailure("EVENT_NOT_FOUND", "Event not found", 404);
    if (!event.mobileSettings.resultsEnabled) {
      return platformFailure("RESULTS_DISABLED", "Results are not enabled for this event", 403);
    }
    const viewer = await participantViewerFromRequest(request);
    const read = await getPublicResultParticipants(event.eventId, viewer);
    if (!read) return platformFailure("RESULTS_NOT_FOUND", "Results are not available", 404);
    let results = resultParticipants(read.data);
    let responseMeta = read;
    if (shouldUseCanonicalResultFallback(results, read.source)) {
      const [canonical, timingConfiguration] = await Promise.all([
        getCanonicalLiveEvent(event.eventId),
        getLiveTrackingHubConfig(event.eventId),
      ]);
      const resolvedCanonical = canonical && timingConfiguration
        ? reconcileProvisionalParticipants(canonical.participants, timingConfiguration)
        : canonical?.participants ?? [];
      results = resultParticipants(resolvedCanonical.map((participant) =>
        sanitizePublicParticipantSplits(participant, timingConfiguration)));
      if (canonical && results.length) {
        responseMeta = {
          ...read,
          lastUpdatedAt: canonicalManifestUpdatedAt(canonical.manifest),
          source: "timing-provider",
          provider: canonical.manifest.provider.toLowerCase() === "feibot" ? "FEIBOT" : "RACE_UPSHOT",
          isStale: false,
        };
      }
    }
    return platformSuccess(results, { ...responseMeta, eventId: event.eventId, cacheSeconds: viewer ? 0 : 30 }, {
      headers: viewer ? { "cache-control": "private, no-store" } : undefined,
    });
  } catch (error) {
    return platformFailure("RESULTS_UNAVAILABLE", error instanceof Error ? error.message : "Unable to load results", 503);
  }
}
