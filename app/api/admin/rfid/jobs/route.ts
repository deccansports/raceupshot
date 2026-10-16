import { z } from "zod";
import { apiFailure, apiSuccess } from "@/lib/api-response";
import { requireAdmin } from "@/lib/admin-guard";
import { getAuthenticatedAdminEmail } from "@/lib/admin-auth";
import { createRfidDraftJob } from "@/lib/rfid-encoder-repository";

const schema = z.object({
  name: z.string().trim().max(120).default(""), prefix: z.string().trim().max(64),
  startingSequence: z.string().trim().min(1).max(64), digits: z.number().int().min(1).max(64),
  increment: z.number().int().min(1).max(1_000_000), total: z.number().int().min(1).max(10_000),
  epcLength: z.number().int().min(2).max(128),
});

export async function POST(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return apiFailure(parsed.error.issues[0]?.message || "Invalid bulk job configuration.", 400);
    const operator = await getAuthenticatedAdminEmail();
    const job = await createRfidDraftJob({ ...parsed.data, createdBy: operator || "admin" });
    return apiSuccess(job, { status: 201, headers: { "cache-control": "no-store" } });
  } catch (error) {
    return apiFailure(error instanceof Error ? error.message : "Bulk encoding job could not be created.", 400);
  }
}
