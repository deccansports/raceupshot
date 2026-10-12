import { isAdminAuthenticated } from "@/lib/admin-auth";
import { getFeibotOperationsDashboard, runFeibotOperation } from "@/lib/feibot-integration";
import { platformFailure, platformSuccess } from "@/lib/platform-api-response";
import { z } from "@/lib/zod";

export const dynamic = "force-dynamic";

const actionSchema = z.object({
  action: z.enum([
    "IMPORT_TIMING_RULES", "REBUILD_SPLIT_INDEX", "VALIDATE_KV", "REFRESH_STATUS",
    "TEST_TIMING_RULES", "TEST_PARTICIPANTS", "FULL_REBUILD", "HARD_RESET_SYNC",
    "DELETE_IMPORTED_DATA", "CANONICAL_SUMMARY", "CLEAR_LOGS",
    "FETCH_FEIBOT_READS", "FETCH_FEIBOT_RESULTS",
  ]),
});

export async function GET(_request: Request, { params }: { params: Promise<{ eventId: string }> }) {
  if (!await isAdminAuthenticated()) return platformFailure("ADMIN_AUTH_REQUIRED", "Admin authentication required.", 401);
  try {
    const { eventId } = await params;
    return platformSuccess(await getFeibotOperationsDashboard(eventId), { eventId, cacheSeconds: 0 }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return platformFailure("FEIBOT_OPERATIONS_UNAVAILABLE", error instanceof Error ? error.message : "Unable to load Feibot operations.", 503);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ eventId: string }> }) {
  if (!await isAdminAuthenticated()) return platformFailure("ADMIN_AUTH_REQUIRED", "Admin authentication required.", 401);
  try {
    const parsed = actionSchema.safeParse(await request.json());
    if (!parsed.success) return platformFailure("INVALID_FEIBOT_OPERATION", parsed.error.issues[0]?.message ?? "Invalid operation.", 400);
    const { eventId } = await params;
    return platformSuccess(await runFeibotOperation(eventId, parsed.data.action), { eventId, cacheSeconds: 0 }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return platformFailure("FEIBOT_OPERATION_FAILED", error instanceof Error ? error.message : "Feibot operation failed.", 502);
  }
}
