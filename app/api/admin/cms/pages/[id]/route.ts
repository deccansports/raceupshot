import { requireAdmin } from "@/lib/admin-guard";
import { apiFailure, apiSuccess } from "@/lib/api-response";
import { cmsPageSchema } from "@/lib/cms-schema";
import { deleteCmsPage, publishCmsPage, saveCmsPageDraft } from "@/lib/raceupshot-repository";
import { z } from "@/lib/zod";

export const dynamic = "force-dynamic";

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    const input = cmsPageSchema.safeParse(await request.json());
    if (!input.success) return apiFailure(input.error.issues[0]?.message || "Invalid CMS page", 400);
    const { id } = await params;
    if (input.data.id !== id) return apiFailure("CMS page ID does not match the requested page.", 400);
    return apiSuccess(await saveCmsPageDraft(input.data), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return apiFailure(error instanceof Error ? error.message : "Unable to save CMS page", 400);
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    const action = z.object({ action: z.literal("publish") }).safeParse(await request.json());
    if (!action.success) return apiFailure("Unsupported CMS action", 400);
    const { id } = await params;
    return apiSuccess(await publishCmsPage(id), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return apiFailure(error instanceof Error ? error.message : "Unable to publish CMS page", 400);
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    const { id } = await params;
    await deleteCmsPage(id);
    return apiSuccess({ deleted: true }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return apiFailure(error instanceof Error ? error.message : "Unable to delete CMS page", 400);
  }
}
