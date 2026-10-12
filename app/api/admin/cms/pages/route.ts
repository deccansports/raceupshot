import { requireAdmin } from "@/lib/admin-guard";
import { apiFailure, apiSuccess } from "@/lib/api-response";
import { cmsPageSchema } from "@/lib/cms-schema";
import { getCmsPages, saveCmsPageDraft, saveCmsPageOrder } from "@/lib/raceupshot-repository";
import { z } from "@/lib/zod";

export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    return apiSuccess(await getCmsPages(), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return apiFailure(error instanceof Error ? error.message : "Unable to load CMS pages", 503);
  }
}

export async function POST(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    const input = cmsPageSchema.safeParse(await request.json());
    if (!input.success) return apiFailure(input.error.issues[0]?.message || "Invalid CMS page", 400);
    return apiSuccess(await saveCmsPageDraft(input.data), { status: 201, headers: { "cache-control": "no-store" } });
  } catch (error) {
    return apiFailure(error instanceof Error ? error.message : "Unable to create CMS page", 400);
  }
}

export async function PATCH(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    const input = z.object({
      action: z.literal("reorder"),
      ids: z.array(z.string().min(1)).min(1).max(200),
    }).safeParse(await request.json());
    if (!input.success) return apiFailure(input.error.issues[0]?.message || "Invalid page order", 400);
    return apiSuccess(await saveCmsPageOrder(input.data.ids), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return apiFailure(error instanceof Error ? error.message : "Unable to save page order", 400);
  }
}
