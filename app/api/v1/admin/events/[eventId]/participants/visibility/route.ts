import { requireAdmin } from "@/lib/admin-guard";
import { platformFailure, platformSuccess } from "@/lib/platform-api-response";
import {
  getAdminLiveParticipantVisibility,
  saveAdminLiveParticipantVisibility,
} from "@/lib/platform-repository";
import { z } from "@/lib/zod";

export const dynamic = "force-dynamic";

const visibilityInput = z.object({
  participantUid: z.string().trim().min(1).max(200),
  visibility: z.enum(["PUBLIC", "ANONYMOUS", "PRIVATE"]).nullable(),
});

export async function GET(_request: Request, { params }: { params: Promise<{ eventId: string }> }) {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    const { eventId } = await params;
    const data = await getAdminLiveParticipantVisibility(eventId);
    return data
      ? platformSuccess(data, { eventId: data.event.eventId, cacheSeconds: 0 }, { headers: { "cache-control": "private, no-store" } })
      : platformFailure("EVENT_NOT_FOUND", "Event not found.", 404);
  } catch (error) {
    return platformFailure("VISIBILITY_LIST_FAILED", error instanceof Error ? error.message : "Unable to load athlete visibility.", 503);
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ eventId: string }> }) {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    const { eventId } = await params;
    const parsed = visibilityInput.safeParse(await request.json());
    if (!parsed.success) {
      return platformFailure("INVALID_VISIBILITY", parsed.error.issues[0]?.message || "Choose a valid visibility.", 400);
    }
    const row = await saveAdminLiveParticipantVisibility(eventId, parsed.data.participantUid, parsed.data.visibility);
    return platformSuccess(row, { eventId, cacheSeconds: 0 }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return platformFailure("VISIBILITY_SAVE_FAILED", error instanceof Error ? error.message : "Unable to save athlete visibility.", 400);
  }
}
