import { isAdminAuthenticated } from "@/lib/admin-auth";
import {
  deleteFeibotAccountCredentials,
  getFeibotAccountCredentialStatus,
  saveFeibotAccountCredentials,
  testFeibotAccountCredentials,
} from "@/lib/feibot-integration";
import { platformFailure, platformSuccess } from "@/lib/platform-api-response";
import { z } from "@/lib/zod";

export const dynamic = "force-dynamic";

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save"), accountId: z.string().trim().min(1).max(160), accessKey: z.string().trim().min(1).max(500), secretKey: z.string().trim().min(1).max(500), baseUrl: z.string().url().max(500).optional() }),
  z.object({ action: z.literal("test"), eventUuid: z.string().trim().min(6).max(100) }),
]);

export async function GET() {
  if (!await isAdminAuthenticated()) return platformFailure("ADMIN_AUTH_REQUIRED", "Admin authentication required.", 401);
  return platformSuccess(await getFeibotAccountCredentialStatus(), { cacheSeconds: 0 }, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  if (!await isAdminAuthenticated()) return platformFailure("ADMIN_AUTH_REQUIRED", "Admin authentication required.", 401);
  try {
    const parsed = actionSchema.safeParse(await request.json());
    if (!parsed.success) return platformFailure("INVALID_FEIBOT_ACCOUNT_REQUEST", parsed.error.issues[0]?.message ?? "Invalid account credential request.", 400);
    const data = parsed.data.action === "save"
      ? await saveFeibotAccountCredentials(parsed.data)
      : await testFeibotAccountCredentials(parsed.data.eventUuid);
    return platformSuccess(data, { cacheSeconds: 0 }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return platformFailure("FEIBOT_ACCOUNT_REQUEST_FAILED", error instanceof Error ? error.message : "Unable to process Feibot account credentials.", 502);
  }
}

export async function DELETE() {
  if (!await isAdminAuthenticated()) return platformFailure("ADMIN_AUTH_REQUIRED", "Admin authentication required.", 401);
  try {
    return platformSuccess(await deleteFeibotAccountCredentials(), { cacheSeconds: 0 }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return platformFailure("FEIBOT_ACCOUNT_DELETE_FAILED", error instanceof Error ? error.message : "Unable to delete Feibot account credentials.", 500);
  }
}
