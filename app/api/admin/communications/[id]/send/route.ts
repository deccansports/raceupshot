import { requireAdmin } from "@/lib/admin-guard";
import { apiFailure, apiSuccess } from "@/lib/api-response";
import { sendCommunicationBatch } from "@/lib/communications";
import { z } from "@/lib/zod";

const sendInput = z.object({ retryFailed: z.boolean().optional().default(false) });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    const { id } = await params;
    const raw = await request.json().catch(() => ({}));
    const input = sendInput.safeParse(raw);
    if (!input.success) return apiFailure("Check the communication send request.", 400);
    return apiSuccess(await sendCommunicationBatch(id, 200, input.data.retryFailed), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return apiFailure(error instanceof Error ? error.message : "Unable to send communication batch.", 503);
  }
}
