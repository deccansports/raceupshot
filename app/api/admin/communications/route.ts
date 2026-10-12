import { requireAdmin } from "@/lib/admin-guard";
import { apiFailure, apiSuccess } from "@/lib/api-response";
import { listCommunicationCampaigns } from "@/lib/communication-campaigns";
import { campaignInput, createCommunicationCampaign } from "@/lib/communications";

export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    return apiSuccess(await listCommunicationCampaigns(), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return apiFailure(error instanceof Error ? error.message : "Unable to load communications.", 503);
  }
}

export async function POST(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    const input = campaignInput.safeParse(await request.json());
    if (!input.success) return apiFailure(input.error.issues[0]?.message || "Check campaign details.", 400);
    return apiSuccess(await createCommunicationCampaign(input.data), {
      status: 201,
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return apiFailure(error instanceof Error ? error.message : "Unable to create communication.", 503);
  }
}
