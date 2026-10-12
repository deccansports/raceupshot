import { apiFailure, apiSuccess } from "@/lib/api-response";
import { getEvents } from "@/lib/raceupshot-repository";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return apiSuccess(await getEvents());
  } catch (error) {
    return apiFailure(error instanceof Error ? error.message : "Unable to load events", 503);
  }
}
