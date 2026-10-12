import { requireAdmin } from "@/lib/admin-guard";
import { apiFailure, apiSuccess } from "@/lib/api-response";
import { getHomepageSliderConfig, saveHomepageSliderConfig } from "@/lib/raceupshot-repository";
import { z } from "@/lib/zod";

export const dynamic = "force-dynamic";

const slide = z.object({
  id: z.string().min(1),
  eventId: z.string().optional(),
  eventSlug: z.string().optional(),
  eventName: z.string().min(1),
  headline: z.string().min(1),
  description: z.string(),
  image: z.string().min(1),
  imageName: z.string().optional(),
  primaryLabel: z.string().optional(),
  primaryUrl: z.string().optional(),
  secondaryLabel: z.string().optional(),
  secondaryUrl: z.string().optional(),
  enabled: z.boolean(),
  order: z.number(),
});
const config = z.object({ enabled: z.boolean(), slides: z.array(slide).max(20) });

export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    return apiSuccess(await getHomepageSliderConfig(), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return apiFailure(error instanceof Error ? error.message : "Unable to load slider", 503);
  }
}

export async function PUT(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    const input = config.safeParse(await request.json());
    if (!input.success) return apiFailure(input.error.issues[0]?.message || "Invalid slider data", 400);
    return apiSuccess(await saveHomepageSliderConfig(input.data), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return apiFailure(error instanceof Error ? error.message : "Unable to save slider", 400);
  }
}
