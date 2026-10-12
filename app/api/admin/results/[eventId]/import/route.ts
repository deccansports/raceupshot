import { requireAdmin } from "@/lib/admin-guard";
import { apiFailure, apiSuccess } from "@/lib/api-response";
import { importEventResults } from "@/lib/raceupshot-repository";
import { z } from "@/lib/zod";
import { scheduleAutomaticResultNotifications } from '@/lib/automatic-result-notifications';

export const dynamic = "force-dynamic";

const resultImportInput = z.object({
  fileName: z.string().trim().min(1).max(240),
  categoryColumn: z.string().trim().min(1).max(160),
  categoryMappings: z.record(z.string(), z.string()),
  columnMappings: z.record(z.string(), z.string()).optional().default({}),
  replaceExisting: z.boolean().default(false),
  rows: z.array(z.record(z.string(), z.unknown())).min(1).max(25_000),
});

export async function POST(request: Request, { params }: { params: Promise<{ eventId: string }> }) {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    const parsed = resultImportInput.safeParse(await request.json());
    if (!parsed.success) return apiFailure(parsed.error.issues[0]?.message || "Check the spreadsheet import.", 400);
    const { eventId } = await params;
    const result = await importEventResults(eventId, parsed.data);
    await scheduleAutomaticResultNotifications(eventId);
    return apiSuccess(
      result,
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (error) {
    return apiFailure(error instanceof Error ? error.message : "Unable to import results.", 500);
  }
}
