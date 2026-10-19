import { requireAdmin } from "@/lib/admin-guard";
import { apiFailure, apiSuccess } from "@/lib/api-response";
import { getFinishLineLedConfig, saveFinishLineLedConfig } from "@/lib/finish-line-led";
import { z } from "@/lib/zod";
import { LED_FIELD_IDS } from "@/lib/finish-line-led-fields";

export const dynamic = "force-dynamic";

const logoInput = z.object({
  id: z.string().trim().min(1).max(200),
  name: z.string().trim().min(1).max(160),
  logoUrl: z.string().trim().min(1).max(4_000).refine((value) => value.startsWith("/") || /^https?:\/\//i.test(value), "Enter a valid logo URL."),
  kind: z.enum(["EVENT", "SPONSOR"]),
});

const configInput = z.object({
  syncEventLogos: z.boolean().optional(),
  visibleFields: z.array(z.enum(LED_FIELD_IDS)).min(1).max(LED_FIELD_IDS.length).optional(),
  logos: z.array(logoInput).max(140),
  idleRotationSeconds: z.number().int().min(3).max(30),
  finisherRotationSeconds: z.number().int().min(3).max(30),
});

export async function GET(_request: Request, { params }: { params: Promise<{ eventId: string }> }) {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    const { eventId } = await params;
    const data = await getFinishLineLedConfig(eventId);
    return data ? apiSuccess(data, { headers: { "cache-control": "no-store" } }) : apiFailure("Event not found.", 404);
  } catch (error) {
    return apiFailure(error instanceof Error ? error.message : "Unable to load Finish Line LED settings.", 503);
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ eventId: string }> }) {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    const { eventId } = await params;
    const parsed = configInput.safeParse(await request.json());
    if (!parsed.success) return apiFailure(parsed.error.issues[0]?.message || "Invalid LED settings.", 400);
    const config = await saveFinishLineLedConfig(eventId, parsed.data);
    return config ? apiSuccess({ eventId, config }, { headers: { "cache-control": "no-store" } }) : apiFailure("Event not found.", 404);
  } catch (error) {
    return apiFailure(error instanceof Error ? error.message : "Unable to save Finish Line LED settings.", 503);
  }
}
