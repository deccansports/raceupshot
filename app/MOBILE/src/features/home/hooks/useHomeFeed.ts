import { useEvents } from "@/features/events";
import type { LiveEventItem } from "@/features/events";

/** Home dashboard feed sourced from the BERGMAN backend event API. */
export function useHomeFeed() {
  const { events, isLoading, isError, refetch } = useEvents();

  const liveEvents = events.filter((e) => e.status === "live");
  const currentLive = liveEvents[0];
  const upcoming = [
    ...events.filter(
      (e) => e.status === "upcoming" || e.status === "notStarted",
    ),
  ].sort(sortUpcomingEvents);
  const past = events.filter((e) => e.status === "finished");

  return {
    liveEvents,
    currentLive,
    upcoming,
    past,
    isLoading,
    isError,
    refetch,
  };
}

function isTbdDate(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const text = value.trim().toLowerCase();
  return (
    text.includes("tbd") ||
    text.includes("date tbd") ||
    text.includes("to be decided") ||
    text.includes("to-be-decided")
  );
}

function isTbdEvent(event: LiveEventItem): boolean {
  return (
    isTbdDate(event.dateLabel) ||
    isTbdDate(event.startDate) ||
    isTbdDate(event.endDate) ||
    isTbdDate(event.raw?.date) ||
    isTbdDate(event.raw?.eventDate)
  );
}

function parseSortDate(value: string | null | undefined): number | null {
  const text = value?.trim();
  if (!text) return null;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
}

function sortUpcomingEvents(a: LiveEventItem, b: LiveEventItem): number {
  const aTbd = isTbdEvent(a);
  const bTbd = isTbdEvent(b);
  if (aTbd !== bTbd) return aTbd ? 1 : -1;

  const aTime =
    parseSortDate(a.startDate) ??
    parseSortDate(a.endDate) ??
    parseSortDate(a.dateLabel) ??
    Number.POSITIVE_INFINITY;
  const bTime =
    parseSortDate(b.startDate) ??
    parseSortDate(b.endDate) ??
    parseSortDate(b.dateLabel) ??
    Number.POSITIVE_INFINITY;

  return aTime - bTime;
}
