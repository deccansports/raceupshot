import { requireAdmin } from "@/lib/admin-guard";
import { apiFailure, apiSuccess } from "@/lib/api-response";
import { audienceFiltersInput, getCommunicationAudience } from "@/lib/communications";
import { z } from "@/lib/zod";

const previewInput = z.object({
  scope: z.enum(["GLOBAL", "EVENT"]),
  eventId: z.string().trim().max(160).default(""),
  filters: audienceFiltersInput,
});

export async function POST(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    const input = previewInput.safeParse(await request.json());
    if (!input.success) return apiFailure(input.error.issues[0]?.message || "Check audience filters.", 400);
    if (input.data.scope === "EVENT" && !input.data.eventId) return apiFailure("Choose an event.", 400);
    const audience = await getCommunicationAudience(input.data.scope, input.data.eventId, input.data.filters);
    return apiSuccess({
      count: audience.length,
      sample: audience.slice(0, 8),
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return apiFailure(error instanceof Error ? error.message : "Unable to preview audience.", 503);
  }
}
