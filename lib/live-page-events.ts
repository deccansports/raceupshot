import type { EventStatus } from "./types";

interface LivePageEvent {
  dateIso: string;
  status: EventStatus;
}

const pastStatuses = new Set<EventStatus>(["completed", "official", "provisional"]);

function eventTimestamp(event: LivePageEvent): number {
  const timestamp = new Date(event.dateIso).valueOf();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function groupLivePageEvents<T extends LivePageEvent>(events: T[]): { live: T[]; upcoming: T[]; past: T[] } {
  return {
    live: events.filter((event) => event.status === "live"),
    upcoming: events
      .filter((event) => event.status === "upcoming")
      .sort((left, right) => eventTimestamp(left) - eventTimestamp(right)),
    past: events
      .filter((event) => pastStatuses.has(event.status))
      .sort((left, right) => eventTimestamp(right) - eventTimestamp(left)),
  };
}
