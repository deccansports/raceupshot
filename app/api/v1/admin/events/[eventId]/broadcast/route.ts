import { isAdminAuthenticated } from "@/lib/admin-auth";
import { getLiveBroadcastConfig, saveLiveBroadcastConfig } from "@/lib/live-broadcast";
import { platformFailure, platformSuccess } from "@/lib/platform-api-response";
import { liveBroadcastConfigSchema } from "@/packages/contracts/src/schemas";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ eventId: string }> }) {
  if (!await isAdminAuthenticated()) return platformFailure("ADMIN_AUTH_REQUIRED", "Admin authentication required.", 401);
  try {
    const { eventId } = await params;
    const config = await getLiveBroadcastConfig(eventId);
    return config
      ? platformSuccess(config, { eventId: config.eventId, cacheSeconds: 0 }, { headers: { "cache-control": "no-store" } })
      : platformFailure("EVENT_NOT_FOUND", "Event not found", 404);
  } catch (error) {
    return platformFailure("BROADCAST_SETTINGS_UNAVAILABLE", error instanceof Error ? error.message : "Unable to load broadcast settings", 503);
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ eventId: string }> }) {
  if (!await isAdminAuthenticated()) return platformFailure("ADMIN_AUTH_REQUIRED", "Admin authentication required.", 401);
  try {
    const { eventId } = await params;
    const parsed = liveBroadcastConfigSchema.safeParse(await request.json());
    if (!parsed.success) return platformFailure("INVALID_BROADCAST_SETTINGS", parsed.error.issues[0]?.message ?? "Invalid broadcast settings", 400);
    if (parsed.data.eventId !== eventId) return platformFailure("EVENT_ID_MISMATCH", "Broadcast settings do not match this event", 400);
    const config = await saveLiveBroadcastConfig(eventId, parsed.data);
    return platformSuccess(config, { eventId: config.eventId, cacheSeconds: 0 }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return platformFailure("BROADCAST_SETTINGS_SAVE_FAILED", error instanceof Error ? error.message : "Unable to save broadcast settings", 400);
  }
}
