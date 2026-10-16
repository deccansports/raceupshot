import { requireAdmin } from "@/lib/admin-guard";
import { apiFailure, apiSuccess } from "@/lib/api-response";
import { sendWhatsAppCampaignBatch } from "@/lib/whatsapp-campaigns";
import { z } from "@/lib/zod";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAdmin(); if (denied) return denied;
  try { const { id } = await params; const input = z.object({ retryFailed: z.boolean().default(false) }).safeParse(await request.json().catch(() => ({}))); if (!input.success) return apiFailure("Check the WhatsApp send request.", 400); return apiSuccess(await sendWhatsAppCampaignBatch(id, input.data.retryFailed), { headers: { "cache-control": "private, no-store" } }); }
  catch (error) { return apiFailure(error instanceof Error ? error.message : "Unable to send WhatsApp campaign batch.", 503); }
}
