import { z } from "zod";
import { apiFailure, apiSuccess } from "@/lib/api-response";
import { requireAdmin } from "@/lib/admin-guard";
import { getAuthenticatedAdminEmail } from "@/lib/admin-auth";
import { recordRfidBridgeWrite } from "@/lib/rfid-encoder-repository";

const schema = z.object({
  transactionId: z.string().uuid(), readerId: z.string().trim().min(1).max(180),
  originalEpc: z.string().regex(/^[0-9A-F]+$/).max(128), requestedEpc: z.string().regex(/^[0-9A-F]+$/).max(128),
  verifiedEpc: z.string().regex(/^[0-9A-F]+$/).max(128).optional(), tid: z.string().regex(/^[0-9A-F]+$/).max(128).optional().nullable(),
  startedAt: z.string().datetime(), completedAt: z.string().datetime(), sdkResponse: z.string().max(1000).optional(),
  verificationResult: z.string().max(120).optional(), error: z.string().max(1000).optional(),
  status: z.enum(["VERIFIED", "FAILED", "UNKNOWN_OUTCOME"]),
});

export async function POST(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return apiFailure(parsed.error.issues[0]?.message || "Invalid bridge write record.", 400);
    if (parsed.data.status === "VERIFIED" && parsed.data.verifiedEpc !== parsed.data.requestedEpc) {
      return apiFailure("A verified transaction must contain an exact requested/verified EPC match.", 400);
    }
    const operatorId = await getAuthenticatedAdminEmail();
    const transaction = await recordRfidBridgeWrite({ ...parsed.data, tid: parsed.data.tid || undefined, operatorId: operatorId || "admin" });
    return apiSuccess(transaction, { status: 201, headers: { "cache-control": "no-store" } });
  } catch (error) {
    return apiFailure(error instanceof Error ? error.message : "RFID write record could not be stored.", 400);
  }
}
