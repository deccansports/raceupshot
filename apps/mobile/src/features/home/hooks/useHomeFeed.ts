import { compareUpcomingEvents, useEvents } from "@/features/events";

/** Home dashboard feed sourced from the Race Upshot backend event API. */
export function useHomeFeed() {
  const { events, isLoading, isError, refetch } = useEvents();

  const liveEvents = events.filter((e) => e.status === "live");
  const currentLive = liveEvents[0];
  const upcoming = [
    ...events.filter(
      (e) => e.status === "upcoming" || e.status === "notStarted",
    ),
  ].sort(compareUpcomingEvents);
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
