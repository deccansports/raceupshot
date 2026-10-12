import { requireAdmin } from "@/lib/admin-guard";
import { apiFailure, apiSuccess } from "@/lib/api-response";
import { eventInput } from "@/lib/event-input";
import { createEvent, EventSlugConflictError, getEvents } from "@/lib/raceupshot-repository";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    return apiSuccess(await getEvents({ includeUnpublished: true }), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return apiFailure(error instanceof Error ? error.message : "Unable to load events", 503);
  }
}

export async function POST(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    const input = eventInput.safeParse(await request.json());
    if (!input.success) return apiFailure(input.error.issues[0]?.message || "Invalid event data", 400);
    return apiSuccess(await createEvent(input.data), { status: 201, headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof EventSlugConflictError) {
      return NextResponse.json(
        { ok: false, error: error.message, code: "EVENT_SLUG_CONFLICT", conflict: error.conflict },
        { status: 409, headers: { "cache-control": "no-store" } },
      );
    }
    return apiFailure(error instanceof Error ? error.message : "Unable to create event", 400);
  }
}
