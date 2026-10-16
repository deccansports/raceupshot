import { requireAdmin } from "@/lib/admin-guard";
import { apiFailure, apiSuccess } from "@/lib/api-response";
import {
  customCounterInput,
  deleteVolunteerCustomCounter,
  listVolunteerCustomCounterIssues,
  listVolunteerCustomCounters,
  resetVolunteerCustomCounterIssue,
  saveVolunteerCustomCounter,
} from "@/lib/volunteer-custom-counters";
import { z } from "@/lib/zod";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    const eventId = new URL(request.url).searchParams.get("eventId")?.trim() || undefined;
    const [counters, issues] = await Promise.all([listVolunteerCustomCounters(eventId), listVolunteerCustomCounterIssues(eventId)]);
    return apiSuccess({ counters, issues }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return apiFailure(error instanceof Error ? error.message : "Unable to load custom counters.", 503);
  }
}

export async function POST(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    const input = customCounterInput.safeParse(await request.json());
    if (!input.success) return apiFailure(input.error.issues[0]?.message || "Invalid custom counter.", 400);
    return apiSuccess(await saveVolunteerCustomCounter(input.data), { status: input.data.id ? 200 : 201 });
  } catch (error) {
    return apiFailure(error instanceof Error ? error.message : "Unable to save custom counter.", 400);
  }
}

export async function PATCH(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    const parsed = z.object({ issueId: z.string().trim().min(1) }).safeParse(await request.json());
    if (!parsed.success) return apiFailure("Issue ID is required.", 400);
    return apiSuccess(await resetVolunteerCustomCounterIssue(parsed.data.issueId));
  } catch (error) {
    return apiFailure(error instanceof Error ? error.message : "Unable to reset custom counter issue.", 400);
  }
}

export async function DELETE(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    const id = new URL(request.url).searchParams.get("id")?.trim();
    if (!id) return apiFailure("Counter ID is required.", 400);
    await deleteVolunteerCustomCounter(id);
    return apiSuccess({ deleted: true });
  } catch (error) {
    return apiFailure(error instanceof Error ? error.message : "Unable to delete custom counter.", 400);
  }
}
