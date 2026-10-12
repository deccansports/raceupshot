import { apiFailure, apiSuccess } from "@/lib/api-response";
import { getEventBySlug } from "@/lib/raceupshot-repository";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const event = await getEventBySlug(slug);
    return event ? apiSuccess(event) : apiFailure("Event not found", 404);
  } catch (error) {
    return apiFailure(error instanceof Error ? error.message : "Unable to load event", 503);
  }
}
