import { requireAdmin } from "@/lib/admin-guard";
import { apiFailure, apiSuccess } from "@/lib/api-response";
import { cmsSiteSettingsSchema } from "@/lib/cms-schema";
import { getCmsSiteSettings, saveCmsSiteSettings } from "@/lib/raceupshot-repository";

export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    return apiSuccess(await getCmsSiteSettings(), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return apiFailure(error instanceof Error ? error.message : "Unable to load CMS settings", 503);
  }
}

export async function PUT(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    const input = cmsSiteSettingsSchema.safeParse(await request.json());
    if (!input.success) return apiFailure(input.error.issues[0]?.message || "Invalid CMS settings", 400);
    return apiSuccess(await saveCmsSiteSettings(input.data), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return apiFailure(error instanceof Error ? error.message : "Unable to save CMS settings", 400);
  }
}
