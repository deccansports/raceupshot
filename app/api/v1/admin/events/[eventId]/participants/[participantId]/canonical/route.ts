import { getAuthenticatedAdminEmail } from "@/lib/admin-auth";
import { apiFailure, apiSuccess } from "@/lib/api-response";
import { getAdminLiveParticipantDetail } from "@/lib/platform-repository";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ eventId: string; participantId: string }> },
) {
  if (!await getAuthenticatedAdminEmail()) return apiFailure("Admin authentication required.", 401);
  try {
    const { eventId, participantId } = await params;
    const detail = await getAdminLiveParticipantDetail(eventId, participantId, true);
    if (!detail || !detail.canonical.buildVersion) {
      return apiFailure("Participant not found in this event's active canonical roster.", 404);
    }
    return apiSuccess(detail, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return apiFailure(error instanceof Error ? error.message : "Unable to load canonical participant.", 503);
  }
}
