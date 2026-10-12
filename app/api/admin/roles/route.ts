import { requireAdmin } from "@/lib/admin-guard";
import { apiFailure, apiSuccess } from "@/lib/api-response";
import {
  adminRoleAssignmentInput,
  listRoleAssignments,
  listRoleUsers,
  revokeRoleAssignment,
  saveRoleAssignment,
} from "@/lib/admin-roles";
import { getEvents } from "@/lib/raceupshot-repository";

export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    const [users, assignments] = await Promise.all([listRoleUsers(), listRoleAssignments()]);
    return apiSuccess({ users, assignments }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return apiFailure(error instanceof Error ? error.message : "Unable to load role assignments.", 503);
  }
}

export async function POST(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    const input = adminRoleAssignmentInput.safeParse(await request.json());
    if (!input.success) return apiFailure(input.error.issues[0]?.message || "Invalid role assignment.", 400);
    const events = await getEvents({ includeUnpublished: true });
    const assignment = await saveRoleAssignment(input.data, events.map((event) => event.id));
    return apiSuccess(assignment, { status: 201, headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return apiFailure(error instanceof Error ? error.message : "Unable to save role assignment.", 400);
  }
}

export async function DELETE(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    const id = new URL(request.url).searchParams.get("id")?.trim();
    if (!id) return apiFailure("Role assignment ID is required.", 400);
    const assignment = await revokeRoleAssignment(id);
    return apiSuccess({ deleted: true, assignment }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return apiFailure(error instanceof Error ? error.message : "Unable to revoke role assignment.", 400);
  }
}
