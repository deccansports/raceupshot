import { apiFailure, apiSuccess } from "@/lib/api-response";
import { mobileCorsHeaders, mobileCorsPreflight } from "@/lib/mobile-cors";
import { requireVolunteer } from "@/lib/volunteer-auth";
import { captureVolunteerTiming, listRecentVolunteerTiming, resetVolunteerTiming } from "@/lib/volunteer-operations";
import { getFeibotContestGunStarts } from "@/lib/feibot-integration";
import { z } from "@/lib/zod";

const inputSchema = z.object({
  eventId: z.string().trim().min(1).max(160),
  participantId: z.string().trim().min(1).max(250),
  timingPointId: z.string().trim().min(1).max(160).optional(),
  capturedAt: z.string().datetime({ offset: true }).optional(),
  gunStartAt: z.string().datetime({ offset: true }).optional(),
  deviceTimeZone: z.string().trim().max(100).optional(),
  replaceExisting: z.boolean().optional(),
});

export const dynamic = "force-dynamic";
export const OPTIONS = mobileCorsPreflight;

export async function GET(request: Request) {
  try {
    const { profile } = await requireVolunteer(request);
    const eventId = new URL(request.url).searchParams.get("eventId")?.trim() || "";
    if (!eventId) return apiFailure("Event ID is required.", 400, { headers: mobileCorsHeaders });
    const [recent, contestGunStarts] = await Promise.all([
      listRecentVolunteerTiming({ profile, eventId }),
      getFeibotContestGunStarts(eventId),
    ]);
    return apiSuccess({ recent, contestGunStarts }, { headers: { ...mobileCorsHeaders, "cache-control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load recent timing stamps.";
    const status = message === "VOLUNTEER_AUTH_REQUIRED" ? 401 : /not assigned|disabled/i.test(message) ? 403 : 400;
    return apiFailure(message, status, { headers: mobileCorsHeaders });
  }
}

export async function POST(request: Request) {
  try {
    const { profile } = await requireVolunteer(request);
    const input = inputSchema.safeParse(await request.json());
    if (!input.success) return apiFailure(input.error.issues[0]?.message || "Invalid manual timing read.", 400, { headers: mobileCorsHeaders });
    return apiSuccess(await captureVolunteerTiming({ profile, ...input.data }), { status: 201, headers: { ...mobileCorsHeaders, "cache-control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to record manual timing.";
    const status = message === "VOLUNTEER_AUTH_REQUIRED" ? 401 : /not assigned|disabled/i.test(message) ? 403 : 400;
    return apiFailure(message, status, { headers: mobileCorsHeaders });
  }
}

export async function DELETE(request: Request) {
  try {
    const { profile } = await requireVolunteer(request);
    const url = new URL(request.url);
    const eventId = url.searchParams.get("eventId")?.trim() || "";
    const operationId = url.searchParams.get("operationId")?.trim() || "";
    if (!eventId || !operationId) return apiFailure("Event ID and timing stamp ID are required.", 400, { headers: mobileCorsHeaders });
    return apiSuccess(await resetVolunteerTiming({ profile, eventId, operationId }), { headers: { ...mobileCorsHeaders, "cache-control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to reset the timing stamp.";
    const status = message === "VOLUNTEER_AUTH_REQUIRED" ? 401 : /not assigned|disabled/i.test(message) ? 403 : 400;
    return apiFailure(message, status, { headers: mobileCorsHeaders });
  }
}
