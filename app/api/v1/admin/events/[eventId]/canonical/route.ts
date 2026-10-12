import { isAdminAuthenticated } from "@/lib/admin-auth";
import { getCanonicalAdminSnapshot, getCanonicalLiveManifest, resetCanonicalLiveEvent } from "@/lib/canonical-live-tracking";
import { clearFeibotCanonicalDisplayState } from "@/lib/feibot-integration";
import { platformFailure, platformSuccess } from "@/lib/platform-api-response";
import { getEventPlatformSettings, getPlatformEvent } from "@/lib/platform-repository";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ eventId: string }> }) {
  if (!await isAdminAuthenticated()) return platformFailure("ADMIN_AUTH_REQUIRED", "Admin authentication required.", 401);
  try {
    const { eventId } = await params;
    const event = await getPlatformEvent(eventId, true);
    if (!event) return platformFailure("EVENT_NOT_FOUND", "Event not found", 404);
    const detail = new URL(request.url).searchParams.get("detail") === "1";
    const settings = detail ? await getEventPlatformSettings(event.eventId) : null;
    const data = detail ? await getCanonicalAdminSnapshot(event.eventId, settings?.timingIntegration?.providerEventUuid) : await getCanonicalLiveManifest(event.eventId);
    return platformSuccess(data, { eventId: event.eventId, cacheSeconds: 0 }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return platformFailure("CANONICAL_STATUS_UNAVAILABLE", error instanceof Error ? error.message : "Unable to load canonical status", 503);
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ eventId: string }> }) {
  if (!await isAdminAuthenticated()) return platformFailure("ADMIN_AUTH_REQUIRED", "Admin authentication required.", 401);
  try {
    const { eventId } = await params;
    const event = await getPlatformEvent(eventId, true);
    if (!event) return platformFailure("EVENT_NOT_FOUND", "Event not found", 404);
    const settings = await getEventPlatformSettings(event.eventId);
    const canonical = await resetCanonicalLiveEvent(event.eventId, settings?.timingIntegration?.providerEventUuid);
    const displayState = await clearFeibotCanonicalDisplayState(event.eventId);
    return platformSuccess({ ...canonical, ...displayState }, { eventId: event.eventId, cacheSeconds: 0 }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return platformFailure("CANONICAL_RESET_FAILED", error instanceof Error ? error.message : "Unable to reset canonical data", 500);
  }
}
