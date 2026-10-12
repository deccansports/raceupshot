import { requireAdmin } from "@/lib/admin-guard";
import { apiFailure, apiSuccess } from "@/lib/api-response";
import {
  deleteVolunteer,
  listVolunteerActivity,
  listVolunteerCheckIns,
  listVolunteerManualTimingWithRanks,
  listVolunteers,
  saveVolunteer,
  setVolunteerStatus,
  volunteerProfileInput,
} from "@/lib/volunteer-management";
import { listAuthoritativeTimingChipAssignmentLogs } from "@/lib/volunteer-operations";
import { z } from "@/lib/zod";

export const dynamic = "force-dynamic";

const statusInput = z.object({
  id: z.string().trim().min(1),
  status: z.enum(["INVITED", "ACTIVE", "DISABLED"]),
});

export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    const [volunteers, activity, checkIns, manualTiming, chipAssignmentLogs] = await Promise.all([
      listVolunteers(),
      listVolunteerActivity(),
      listVolunteerCheckIns(),
      listVolunteerManualTimingWithRanks(),
      listAuthoritativeTimingChipAssignmentLogs(),
    ]);
    const authoritativeChipKeys = new Set(chipAssignmentLogs.map((row) => `${row.eventId}\u0000${row.participantUid}\u0000${row.status}`));
    const authoritativeCheckIns = [
      ...checkIns.filter((row) => row.action !== "TIMING_CHIP_ASSIGNED"
        || !authoritativeChipKeys.has(`${row.eventId}\u0000${row.participantUid}\u0000${row.status}`)),
      ...chipAssignmentLogs,
    ].sort((left, right) => Date.parse(right.capturedAt) - Date.parse(left.capturedAt));
    return apiSuccess({ volunteers, activity, checkIns: authoritativeCheckIns, manualTiming }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return apiFailure(error instanceof Error ? error.message : "Unable to load volunteer management.", 503);
  }
}

export async function POST(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    const input = volunteerProfileInput.safeParse(await request.json());
    if (!input.success) return apiFailure(input.error.issues[0]?.message || "Invalid volunteer profile.", 400);
    return apiSuccess(await saveVolunteer(input.data), { status: input.data.id ? 200 : 201, headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return apiFailure(error instanceof Error ? error.message : "Unable to save volunteer.", 400);
  }
}

export async function PATCH(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    const input = statusInput.safeParse(await request.json());
    if (!input.success) return apiFailure(input.error.issues[0]?.message || "Invalid volunteer status.", 400);
    return apiSuccess(await setVolunteerStatus(input.data.id, input.data.status), { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return apiFailure(error instanceof Error ? error.message : "Unable to update volunteer access.", 400);
  }
}

export async function DELETE(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    const id = new URL(request.url).searchParams.get("id")?.trim();
    if (!id) return apiFailure("Volunteer ID is required.", 400);
    return apiSuccess({ deleted: true, volunteer: await deleteVolunteer(id) }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return apiFailure(error instanceof Error ? error.message : "Unable to remove volunteer.", 400);
  }
}
