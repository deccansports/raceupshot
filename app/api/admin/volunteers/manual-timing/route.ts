import { requireAdmin } from "@/lib/admin-guard";
import { apiFailure, apiSuccess } from "@/lib/api-response";
import { deleteVolunteerManualTimingOperation, resetVolunteerManualTimingOperation } from "@/lib/volunteer-management";
import { z } from "@/lib/zod";

export const dynamic = "force-dynamic";

const resetInput = z.object({
  id: z.string().trim().min(1),
});

export async function PATCH(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    const input = resetInput.safeParse(await request.json());
    if (!input.success) return apiFailure(input.error.issues[0]?.message || "Manual timing record ID is required.", 400);
    return apiSuccess(await resetVolunteerManualTimingOperation(input.data.id), { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return apiFailure(error instanceof Error ? error.message : "Unable to reset the manual timing record.", 400);
  }
}

export async function DELETE(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    const id = new URL(request.url).searchParams.get("id")?.trim() || "";
    if (!id) return apiFailure("Manual timing record ID is required.", 400);
    return apiSuccess({ deleted: true, record: await deleteVolunteerManualTimingOperation(id) }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return apiFailure(error instanceof Error ? error.message : "Unable to delete the manual timing record.", 400);
  }
}
