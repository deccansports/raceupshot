import { requireAdmin } from "@/lib/admin-guard";
import { apiFailure, apiSuccess } from "@/lib/api-response";
import { listVolunteerEventCheckInSummaries } from "@/lib/volunteer-operations";

export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    return apiSuccess(await listVolunteerEventCheckInSummaries(), { headers: { "cache-control": "private, no-store" } });
  } catch {
    return apiFailure("Check-in totals are temporarily unavailable. Retry after the KV connection recovers.", 503);
  }
}
