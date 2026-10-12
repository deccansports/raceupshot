import { requireAdmin } from "@/lib/admin-guard";
import { apiFailure, apiSuccess } from "@/lib/api-response";
import { deleteEventResults } from "@/lib/raceupshot-repository";

export const dynamic = "force-dynamic";

export async function DELETE(_request: Request, { params }: { params: Promise<{ eventId: string }> }) {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    const { eventId } = await params;
    return apiSuccess(await deleteEventResults(eventId), {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return apiFailure(error instanceof Error ? error.message : "Unable to delete results.", 400);
  }
}
