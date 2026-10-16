import { requireAdmin } from "@/lib/admin-guard";
import { apiFailure, apiSuccess } from "@/lib/api-response";
import { deleteVolunteerCheckInOperations } from "@/lib/volunteer-management";
import { z } from "@/lib/zod";

export const dynamic = "force-dynamic";

const deleteInput = z.object({
  ids: z.array(z.string().trim().min(1)).max(500).optional(),
  actions: z.array(z.enum(["WAIVER_VERIFY", "CHECK_IN", "CHECK_IN_REVERSE", "ADMIN_WAIVER_CHECK_IN_RESET"])).max(4).optional(),
  eventId: z.string().trim().min(1).optional(),
});

export async function DELETE(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    const input = deleteInput.safeParse(await request.json());
    if (!input.success) return apiFailure(input.error.issues[0]?.message || "Invalid volunteer log selection.", 400);
    if (!input.data.ids?.length && !input.data.actions?.length) return apiFailure("Choose at least one volunteer log record to delete.", 400);
    return apiSuccess(await deleteVolunteerCheckInOperations(input.data), { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return apiFailure(error instanceof Error ? error.message : "Unable to delete volunteer logs.", 400);
  }
}
