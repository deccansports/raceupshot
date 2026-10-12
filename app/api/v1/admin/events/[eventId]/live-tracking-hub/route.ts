import { requireAdmin } from "@/lib/admin-guard";
import { apiFailure, apiSuccess } from "@/lib/api-response";
import { getLiveTrackingHubConfig, saveLiveTrackingHubConfig } from "@/lib/live-tracking-hub-config";
import { liveTrackingHubConfigSchema } from "@/lib/live-tracking-hub-schema";
import { persistLiveTrackingSplitIndex, persistStoredFeibotOfficialStart } from "@/lib/feibot-integration";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ eventId: string }> }) {
  const denied = await requireAdmin(); if (denied) return denied;
  try {
    const { eventId } = await params;
    const config = await getLiveTrackingHubConfig(eventId);
    return config ? apiSuccess(config, { headers: { "cache-control": "private, no-store" } }) : apiFailure("Event not found.", 404);
  } catch (error) { return apiFailure(error instanceof Error ? error.message : "Unable to load live tracking configuration.", 503); }
}

export async function PUT(request: Request, { params }: { params: Promise<{ eventId: string }> }) {
  const denied = await requireAdmin(); if (denied) return denied;
  try {
    const parsed = liveTrackingHubConfigSchema.safeParse(await request.json());
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const field = issue?.path?.length ? issue.path.join(".") : "configuration";
      return apiFailure(`${field}: ${issue?.message || "Invalid live tracking configuration."}`, 400);
    }
    const { eventId } = await params;
    const saved = await persistStoredFeibotOfficialStart(await saveLiveTrackingHubConfig(eventId, parsed.data));
    await persistLiveTrackingSplitIndex(saved);
    return apiSuccess(saved, { headers: { "cache-control": "private, no-store" } });
  } catch (error) { return apiFailure(error instanceof Error ? error.message : "Unable to save live tracking configuration.", 500); }
}
