import { apiFailure, apiSuccess } from "@/lib/api-response";
import { getPublicResultParticipants } from "@/lib/platform-repository";
import { getEvents } from "@/lib/raceupshot-repository";
import type { Athlete } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const query = new URL(request.url).searchParams.get("q")?.trim().toLowerCase() ?? "";
    if (query.length < 2) return apiSuccess({ events: [], athletes: [] });
    const events = await getEvents();
    const eventMatches = events.filter((event) => `${event.name} ${event.slug} ${event.city}`.toLowerCase().includes(query)).slice(0, 8);
    const resultSets = await Promise.all(events.filter((event) => event.hasResults).map(async (event) => ({
      event,
      participants: (await getPublicResultParticipants(event.id))?.data ?? [],
    })));
    const athletes = resultSets
      .flatMap(({ event, participants }) => participants
        .filter((participant) => participant.visibility === "PUBLIC")
        .map((participant): Athlete => ({
          id: participant.participantUid,
          athleteUid: participant.athleteUid,
          name: participant.displayName,
          bib: participant.bib,
          gender: participant.gender || "",
          ageGroup: participant.ageGroup || "",
          club: participant.club || "",
          city: "",
          country: participant.country || "",
          category: participant.contestName,
          rank: participant.overallRank || 0,
          genderRank: participant.genderRank || 0,
          ageRank: participant.ageGroupRank || 0,
          finishTime: participant.elapsedTime || participant.cumulativeTime || "",
          pace: "",
          status: participant.raceStatus,
          lastSplit: participant.latestTimingPoint || participant.splits.at(-1)?.name || "",
          eventId: event.id,
          eventSlug: event.slug,
          eventName: event.name,
          splits: participant.splits.map((split) => ({ label: split.name, time: split.splitTime })),
          certificateUrl: participant.certificateUrl,
        })))
      .filter((athlete) => athlete.name.toLowerCase().includes(query) || athlete.bib.toLowerCase() === query)
      .slice(0, 12);
    return apiSuccess({ events: eventMatches, athletes });
  } catch (error) {
    return apiFailure(error instanceof Error ? error.message : "Search is unavailable", 503);
  }
}
