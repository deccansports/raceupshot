import { requireAdmin } from "@/lib/admin-guard";
import { apiFailure, apiSuccess } from "@/lib/api-response";
import { createWhatsAppCampaign, getWhatsAppAudience, listWhatsAppCampaigns, sendWhatsAppCampaignTest, whatsappCampaignInput } from "@/lib/whatsapp-campaigns";
import { z } from "@/lib/zod";

export const dynamic = "force-dynamic";
export async function GET() { const denied = await requireAdmin(); if (denied) return denied; try { return apiSuccess(await listWhatsAppCampaigns(), { headers: { "cache-control": "private, no-store" } }); } catch (error) { return apiFailure(error instanceof Error ? error.message : "Unable to load WhatsApp campaigns.", 503); } }
export async function POST(request: Request) {
  const denied = await requireAdmin(); if (denied) return denied;
  try {
    const raw = await request.json(); const input = whatsappCampaignInput.safeParse(raw);
    if (!input.success) return apiFailure(input.error.issues[0]?.message || "Check WhatsApp campaign details.", 400);
    if (raw.action === "PREVIEW") { const recipients = await getWhatsAppAudience(input.data); return apiSuccess({ count: recipients.length, sample: recipients.slice(0, 10) }); }
    if (raw.action === "TEST") { const mobile = z.string().trim().min(8).max(30).safeParse(raw.mobile); if (!mobile.success) return apiFailure("Enter a valid test WhatsApp number.", 400); const result = await sendWhatsAppCampaignTest({ ...input.data, mobile: mobile.data }); return result.accepted ? apiSuccess(result) : apiFailure(result.error || "AiSensy did not accept the test message.", result.ambiguous ? 502 : 400); }
    return apiSuccess(await createWhatsAppCampaign(input.data), { status: 201, headers: { "cache-control": "private, no-store" } });
  } catch (error) { return apiFailure(error instanceof Error ? error.message : "Unable to process WhatsApp campaign.", 503); }
}
