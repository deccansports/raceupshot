import { requireAdmin } from "@/lib/admin-guard";
import { apiFailure, apiSuccess } from "@/lib/api-response";
import { eventInput } from "@/lib/event-input";
import { deleteEvent, EventSlugConflictError, publishEvent, updateEvent } from "@/lib/raceupshot-repository";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    const { id } = await params;
    const body = await request.json() as { action?: string };
    if (body.action !== "publish") return apiFailure("Unsupported event action.", 400);
    return apiSuccess(await publishEvent(id), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return apiFailure(error instanceof Error ? error.message : "Unable to publish event.", 400);
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    const { id } = await params;
    const input = eventInput.safeParse(await request.json());
    if (!input.success) return apiFailure(input.error.issues[0]?.message || "Invalid event data", 400);
    return apiSuccess(await updateEvent(id, input.data), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof EventSlugConflictError) {
      return NextResponse.json(
        { ok: false, error: error.message, code: "EVENT_SLUG_CONFLICT", conflict: error.conflict },
        { status: 409, headers: { "cache-control": "no-store" } },
      );
    }
    return apiFailure(error instanceof Error ? error.message : "Unable to update event", 400);
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    const { id } = await params;
    await deleteEvent(id);
    return apiSuccess({ deleted: true }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return apiFailure(error instanceof Error ? error.message : "Unable to delete event", 400);
  }
}
