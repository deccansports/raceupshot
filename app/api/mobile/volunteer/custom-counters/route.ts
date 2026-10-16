import { apiFailure, apiSuccess } from "@/lib/api-response";
import { mobileCorsHeaders, mobileCorsPreflight } from "@/lib/mobile-cors";
import { requireVolunteer } from "@/lib/volunteer-auth";
import { listVolunteerCustomCounterIssues, listVolunteerCustomCounters, issueVolunteerCustomCounter } from "@/lib/volunteer-custom-counters";
import { activeAssignment, searchVolunteerParticipants } from "@/lib/volunteer-operations";
import { z } from "@/lib/zod";

export const dynamic = "force-dynamic";
export const OPTIONS = mobileCorsPreflight;

export async function GET(request: Request) {
  try {
    const { profile } = await requireVolunteer(request);
    const eventId = new URL(request.url).searchParams.get("eventId")?.trim() || "";
    if (!eventId) return apiFailure("Event ID is required.", 400, { headers: mobileCorsHeaders });
    const assignment = activeAssignment(profile, eventId);
    const allowed = new Set(assignment.customCounterIds ?? []);
    const [counters, issues] = await Promise.all([listVolunteerCustomCounters(eventId), listVolunteerCustomCounterIssues(eventId)]);
    return apiSuccess({
      counters: counters.filter((counter) => counter.active && allowed.has(counter.id)),
      recent: issues.filter((issue) => allowed.has(issue.counterId)).slice(0, 50),
    }, { headers: { ...mobileCorsHeaders, "cache-control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load custom counters.";
    return apiFailure(message, message === "VOLUNTEER_AUTH_REQUIRED" ? 401 : 400, { headers: mobileCorsHeaders });
  }
}

export async function POST(request: Request) {
  try {
    const { profile } = await requireVolunteer(request);
    const parsed = z.object({
      eventId: z.string().trim().min(1),
      counterId: z.string().trim().min(1),
      participantId: z.string().trim().min(1),
    }).safeParse(await request.json());
    if (!parsed.success) return apiFailure(parsed.error.issues[0]?.message || "Invalid custom counter action.", 400, { headers: mobileCorsHeaders });
    const assignment = activeAssignment(profile, parsed.data.eventId);
    if (!(assignment.customCounterIds ?? []).includes(parsed.data.counterId)) throw new Error("This custom counter is not assigned to the volunteer.");
    const counter = (await listVolunteerCustomCounters(parsed.data.eventId)).find((row) => row.id === parsed.data.counterId && row.active);
    if (!counter) throw new Error("This custom counter is unavailable.");
    const result = await searchVolunteerParticipants({ profile, eventId: parsed.data.eventId, query: parsed.data.participantId });
    const participant = result.participants.find((row) => row.id === parsed.data.participantId || row.bib === parsed.data.participantId);
    if (!participant) throw new Error("Athlete is not available in this event roster.");
    if (counter.applicableCategories.length && !counter.applicableCategories.some((value) => value.toLowerCase() === participant.category.toLowerCase())) {
      throw new Error(`${counter.name} is not available for this athlete category.`);
    }
    const issue = await issueVolunteerCustomCounter({
      counterId: counter.id,
      eventId: parsed.data.eventId,
      participantUid: participant.id,
      bib: participant.bib,
      athleteName: participant.name,
      volunteerId: profile.id,
      volunteerName: profile.name,
      quantity: counter.quantityPerServing,
    });
    return apiSuccess({ issue, counter, participant }, { status: 201, headers: { ...mobileCorsHeaders, "cache-control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to record the custom counter action.";
    return apiFailure(message, message === "VOLUNTEER_AUTH_REQUIRED" ? 401 : /not assigned|disabled/i.test(message) ? 403 : 400, { headers: mobileCorsHeaders });
  }
}
