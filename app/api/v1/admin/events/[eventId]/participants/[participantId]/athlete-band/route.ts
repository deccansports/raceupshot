import { getAuthenticatedAdminEmail } from "@/lib/admin-auth";
import { apiFailure, apiSuccess } from "@/lib/api-response";
import { removeParticipantAthleteBand, replaceParticipantAthleteBand } from "@/lib/participant-chip-assignments";
import { z } from "@/lib/zod";

export const dynamic = "force-dynamic";

const inputSchema = z.object({
  athleteBandCode: z.string().trim().min(1).max(150).regex(/^[A-Za-z0-9._:-]+$/, "Athlete band code can contain letters, numbers, dots, underscores, colons and dashes."),
  reason: z.string().trim().min(3).max(500),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ eventId: string; participantId: string }> }) {
  const changedBy = await getAuthenticatedAdminEmail();
  if (!changedBy) return apiFailure("Admin authentication required.", 401);
  try {
    const parsed = inputSchema.safeParse(await request.json());
    if (!parsed.success) return apiFailure(parsed.error.issues[0]?.message || "Check the athlete band details.", 400);
    const { eventId, participantId } = await params;
    return apiSuccess(await replaceParticipantAthleteBand({
      eventIdOrSlug: eventId,
      participantId,
      athleteBandCode: parsed.data.athleteBandCode,
      reason: parsed.data.reason,
      changedBy,
    }), { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return apiFailure(error instanceof Error ? error.message : "Unable to assign the athlete band.", 400);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ eventId: string; participantId: string }> }) {
  const changedBy = await getAuthenticatedAdminEmail();
  if (!changedBy) return apiFailure("Admin authentication required.", 401);
  try {
    const reason = new URL(request.url).searchParams.get("reason")?.trim() || "Removed from Participants admin";
    const { eventId, participantId } = await params;
    return apiSuccess(await removeParticipantAthleteBand({ eventIdOrSlug: eventId, participantId, reason, changedBy }), { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return apiFailure(error instanceof Error ? error.message : "Unable to remove the athlete band.", 400);
  }
}
