import { requireAdmin } from "@/lib/admin-guard";
import { apiFailure, apiSuccess } from "@/lib/api-response";
import { getCertificateTemplates, saveCertificateTemplate } from "@/lib/raceupshot-repository";
import { z } from "@/lib/zod";

export const dynamic = "force-dynamic";

const element = z.object({
  id: z.string(),
  variable: z.string(),
  label: z.string(),
  sample: z.string(),
  x: z.number().min(0).max(100),
  y: z.number().min(0).max(100),
  fontSize: z.number().min(8).max(100),
  color: z.string(),
  weight: z.enum(["400", "700"]),
});
const template = z.object({
  eventSlug: z.string(),
  category: z.string(),
  artworkName: z.string().optional(),
  artworkType: z.string().optional(),
  artworkData: z.string().optional(),
  elements: z.array(element),
  savedAt: z.string(),
});

export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    return apiSuccess(await getCertificateTemplates(), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return apiFailure(error instanceof Error ? error.message : "Unable to load templates", 503);
  }
}

export async function PUT(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    const input = template.safeParse(await request.json());
    if (!input.success) return apiFailure(input.error.issues[0]?.message || "Invalid template", 400);
    return apiSuccess(await saveCertificateTemplate(input.data), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return apiFailure(error instanceof Error ? error.message : "Unable to save template", 400);
  }
}
