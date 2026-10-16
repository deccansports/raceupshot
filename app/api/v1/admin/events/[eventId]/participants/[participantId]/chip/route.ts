import { getAuthenticatedAdminEmail } from "@/lib/admin-auth";
import { apiFailure, apiSuccess } from "@/lib/api-response";
import { removeParticipantChip, replaceParticipantChip } from "@/lib/participant-chip-assignments";
import { z } from "@/lib/zod";

export const dynamic = "force-dynamic";

const inputSchema = z.object({
  chipCode: z.string().trim().min(1).max(150).regex(/^[A-Za-z0-9._:-]+$/, "Chip code can contain letters, numbers, dots, underscores, colons and dashes."),
  reason: z.string().trim().min(3).max(500),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ eventId: string; participantId: string }> }) {
  const changedBy = await getAuthenticatedAdminEmail();
  if (!changedBy) return apiFailure("Admin authentication required.", 401);
  try {
    const parsed = inputSchema.safeParse(await request.json());
    if (!parsed.success) return apiFailure(parsed.error.issues[0]?.message || "Check the replacement chip details.", 400);
    const { eventId, participantId } = await params;
    return apiSuccess(await replaceParticipantChip({
      eventIdOrSlug: eventId,
      participantId,
      chipCode: parsed.data.chipCode,
      reason: parsed.data.reason,
      changedBy,
    }), { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return apiFailure(error instanceof Error ? error.message : "Unable to replace the participant chip.", 400);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ eventId: string; participantId: string }> }) {
  const changedBy = await getAuthenticatedAdminEmail();
  if (!changedBy) return apiFailure("Admin authentication required.", 401);
  try {
    const { eventId, participantId } = await params;
    const reason = new URL(request.url).searchParams.get("reason")?.trim() || "Removed from Participants admin";
    return apiSuccess(await removeParticipantChip({ eventIdOrSlug: eventId, participantId, reason, changedBy }), { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return apiFailure(error instanceof Error ? error.message : "Unable to remove the participant chip.", 400);
  }
}
