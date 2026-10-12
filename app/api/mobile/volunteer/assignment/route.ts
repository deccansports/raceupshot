import { apiFailure, apiSuccess } from "@/lib/api-response";
import { mobileCorsHeaders, mobileCorsPreflight } from "@/lib/mobile-cors";
import { requireVolunteer } from "@/lib/volunteer-auth";
import { getEventBySlug } from "@/lib/raceupshot-repository";
import { listVolunteerEventOptions, MANUAL_GUN_FINISH_ID, MANUAL_GUN_FINISH_NAME, normalizeVolunteerModules } from "@/lib/volunteer-management";

export const dynamic = "force-dynamic";
export const OPTIONS = mobileCorsPreflight;

export async function GET(request: Request) {
  try {
    const { profile } = await requireVolunteer(request);
    const eventOptions = await listVolunteerEventOptions();
    const eventOptionById = new Map(eventOptions.map((event) => [event.id, event]));
    const assignments = await Promise.all(profile.assignments.filter((assignment) => assignment.active).map(async (assignment) => {
      const event = await getEventBySlug(assignment.eventId, { includeUnpublished: true });
      const current = eventOptionById.get(assignment.eventId);
      const automaticTiming = assignment.modules.includes("MANUAL_TIMING") && assignment.timingPointIds.length === 0;
      const finishPoint = current?.timingPoints.filter((point) => point.type === "FINISH").at(-1);
      return {
        ...assignment,
        modules: normalizeVolunteerModules(assignment.modules),
        providerEventUuid: current?.providerEventUuid ?? assignment.providerEventUuid,
        contestUuids: current?.contestUuids ?? assignment.contestUuids,
        timingPointIds: automaticTiming ? [finishPoint?.id || MANUAL_GUN_FINISH_ID] : assignment.timingPointIds,
        timingPointNames: automaticTiming ? [finishPoint?.name || MANUAL_GUN_FINISH_NAME] : assignment.timingPointNames,
        timingScope: automaticTiming ? "AUTO" : "RESTRICTED",
        manualGunFallback: automaticTiming && !finishPoint,
        eventDate: event?.dateIso || null,
        eventLocation: event?.location || "",
        eventLogoUrl: event?.logoUrl || null,
        waiverRequired: Boolean(event?.waiverHtml),
        waiverVersion: event?.waiverVersion || "",
      };
    }));
    return apiSuccess({
      volunteer: { id: profile.id, name: profile.name, email: profile.email, mobile: profile.mobile },
      assignments,
      refreshedAt: new Date().toISOString(),
    }, { headers: { ...mobileCorsHeaders, "cache-control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Volunteer assignment is unavailable.";
    const status = message.includes("AUTH_REQUIRED") ? 401 : message.includes("DISABLED") ? 403 : 503;
    return apiFailure(message.replace(/^VOLUNTEER_/, "Volunteer ").replaceAll("_", " ").toLowerCase(), status, { headers: mobileCorsHeaders });
  }
}
