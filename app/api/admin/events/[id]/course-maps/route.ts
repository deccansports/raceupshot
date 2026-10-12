import { requireAdmin } from "@/lib/admin-guard";
import { apiFailure, apiSuccess } from "@/lib/api-response";
import { getAdminEventCourseMaps, saveEventCourseMaps } from "@/lib/course-maps";
import { eventCourseCollectionInputSchema } from "@/packages/contracts/src/schemas";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    const { id } = await params;
    const collection = await getAdminEventCourseMaps(id);
    return collection
      ? apiSuccess(collection, { headers: { "cache-control": "private, no-store" } })
      : apiFailure("Event not found.", 404);
  } catch (error) {
    return apiFailure(error instanceof Error ? error.message : "Unable to load course maps.", 503);
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    const { id } = await params;
    const parsed = eventCourseCollectionInputSchema.safeParse(await request.json());
    if (!parsed.success) return apiFailure(parsed.error.issues[0]?.message || "Invalid course-map data.", 400);
    return apiSuccess(
      await saveEventCourseMaps(id, parsed.data.maps),
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (error) {
    return apiFailure(error instanceof Error ? error.message : "Unable to save course maps.", 500);
  }
}
