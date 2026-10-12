import { isAdminAuthenticated } from "@/lib/admin-auth";
import { platformFailure, platformSuccess } from "@/lib/platform-api-response";
import { getEventPlatformSettings, saveEventPlatformSettings } from "@/lib/platform-repository";
import { eventPlatformSettingsSchema } from "@/packages/contracts/src/schemas";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ eventId: string }> }) {
  if (!await isAdminAuthenticated()) return platformFailure("ADMIN_AUTH_REQUIRED", "Admin authentication required.", 401);
  try {
    const { eventId } = await params;
    const settings = await getEventPlatformSettings(eventId);
    return settings
      ? platformSuccess(settings, { eventId: settings.eventId, cacheSeconds: 0 }, { headers: { "cache-control": "no-store" } })
      : platformFailure("EVENT_NOT_FOUND", "Event not found", 404);
  } catch (error) {
    return platformFailure("SETTINGS_UNAVAILABLE", error instanceof Error ? error.message : "Unable to load settings", 503);
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ eventId: string }> }) {
  if (!await isAdminAuthenticated()) return platformFailure("ADMIN_AUTH_REQUIRED", "Admin authentication required.", 401);
  try {
    const { eventId } = await params;
    const parsed = eventPlatformSettingsSchema.safeParse(await request.json());
    if (!parsed.success) {
      return platformFailure("INVALID_PLATFORM_SETTINGS", parsed.error.issues[0]?.message ?? "Invalid settings", 400);
    }
    if (parsed.data.eventId !== eventId) {
      return platformFailure("EVENT_ID_MISMATCH", "Settings do not match the requested event", 400);
    }
    const settings = await saveEventPlatformSettings(eventId, parsed.data);
    return platformSuccess(settings, { eventId: settings.eventId, cacheSeconds: 0 }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return platformFailure("SETTINGS_SAVE_FAILED", error instanceof Error ? error.message : "Unable to save settings", 400);
  }
}
