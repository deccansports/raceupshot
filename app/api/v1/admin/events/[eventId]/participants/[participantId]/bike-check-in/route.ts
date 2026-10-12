import { getAuthenticatedAdminEmail } from "@/lib/admin-auth";
import { apiFailure, apiSuccess } from "@/lib/api-response";
import { resetAdminVolunteerBikeCheckIn } from "@/lib/volunteer-operations";

export const dynamic = "force-dynamic";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ eventId: string; participantId: string }> },
) {
  const adminName = await getAuthenticatedAdminEmail();
  if (!adminName) return apiFailure("Admin authentication required.", 401);
  try {
    const { eventId, participantId } = await params;
    const state = await resetAdminVolunteerBikeCheckIn({ eventId, participantId, adminName });
    return apiSuccess({ state }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to reset bike check-in.";
    const status = /not found/i.test(message) ? 404 : /no bike check-in state/i.test(message) ? 409 : 400;
    return apiFailure(message, status);
  }
}
