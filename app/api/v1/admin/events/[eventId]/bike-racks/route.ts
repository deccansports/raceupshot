import { getAuthenticatedAdminEmail } from "@/lib/admin-auth";
import { apiFailure, apiSuccess } from "@/lib/api-response";
import { getBikeRackConfiguration, saveBikeRackConfiguration } from "@/lib/bike-racks";
import { getEventBySlug } from "@/lib/raceupshot-repository";
import { z } from "@/lib/zod";

export const dynamic = "force-dynamic";

const input = z.object({ ranges: z.array(z.object({
  id: z.string().trim().max(100), rackName: z.string().trim().min(1).max(80),
  bibFrom: z.number().int().positive(), bibTo: z.number().int().positive(),
})).max(200) });

export async function GET(_request: Request, { params }: { params: Promise<{ eventId: string }> }) {
  if (!await getAuthenticatedAdminEmail()) return apiFailure("Admin authentication required.", 401);
  try {
    const event = await getEventBySlug((await params).eventId, { includeUnpublished: true });
    if (!event) return apiFailure("Event not found.", 404);
    return apiSuccess(await getBikeRackConfiguration(event.id), { headers: { "cache-control": "private, no-store" } });
  } catch (error) { return apiFailure(error instanceof Error ? error.message : "Unable to load bike racks.", 503); }
}

export async function PUT(request: Request, { params }: { params: Promise<{ eventId: string }> }) {
  const actor = await getAuthenticatedAdminEmail();
  if (!actor) return apiFailure("Admin authentication required.", 401);
  try {
    const event = await getEventBySlug((await params).eventId, { includeUnpublished: true });
    if (!event) return apiFailure("Event not found.", 404);
    const parsed = input.safeParse(await request.json());
    if (!parsed.success) return apiFailure(parsed.error.issues[0]?.message || "Check rack ranges.", 400);
    return apiSuccess(await saveBikeRackConfiguration(event.id, parsed.data.ranges, actor), { headers: { "cache-control": "private, no-store" } });
  } catch (error) { return apiFailure(error instanceof Error ? error.message : "Unable to save bike racks.", 400); }
}
