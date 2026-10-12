import { requireAdmin } from "@/lib/admin-guard";
import { apiFailure, apiSuccess } from "@/lib/api-response";
import { getEventBySlug, getEventPartners, replaceEventPartners } from "@/lib/raceupshot-repository";
import { z } from "@/lib/zod";

export const dynamic = "force-dynamic";

// Expo Web runs on a different origin during development. Partners are public
// event data, so explicitly allow the mobile web client to read this endpoint.
const publicCorsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "accept, authorization, content-type",
  "access-control-max-age": "86400",
};

function publicResponse(response: Response) {
  for (const [name, value] of Object.entries(publicCorsHeaders)) response.headers.set(name, value);
  return response;
}

const partnerInput = z.object({
  id: z.string().min(1).max(200),
  name: z.string().trim().min(1).max(160),
  logoUrl: z.string().url().max(4_000),
  website: z.string().url().max(4_000).optional().or(z.literal("")),
  type: z.string().trim().max(100).optional(),
  order: z.number().int().min(0).max(500),
});

const partnersInput = z.object({ sponsors: z.array(partnerInput).max(100) });

export function OPTIONS() {
  return new Response(null, { status: 204, headers: publicCorsHeaders });
}

export async function GET(_request: Request, { params }: { params: Promise<{ eventId: string }> }) {
  try {
    const { eventId: eventReference } = await params;
    const event = await getEventBySlug(eventReference, { includeUnpublished: true });
    if (!event) return publicResponse(apiFailure("Event not found.", 404));
    const sponsors = await getEventPartners(event.id);
    return publicResponse(apiSuccess(
      { success: true, eventId: event.id, count: sponsors?.length ?? 0, sponsors: sponsors ?? [] },
      { headers: { "cache-control": "no-store" } },
    ));
  } catch (error) {
    return publicResponse(apiFailure(error instanceof Error ? error.message : "Unable to load event partners", 503));
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ eventId: string }> }) {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    const { eventId } = await params;
    const input = partnersInput.safeParse(await request.json());
    if (!input.success) return apiFailure(input.error.issues[0]?.message || "Invalid partner data", 400);
    const sponsors = await replaceEventPartners(eventId, input.data.sponsors);
    return apiSuccess({ success: true, eventId, count: sponsors.length, sponsors }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return apiFailure(error instanceof Error ? error.message : "Unable to save event partners", 400);
  }
}
