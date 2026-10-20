import { describe, expect, it } from "vitest";
import { groupLivePageEvents } from "../lib/live-page-events";
import type { EventStatus } from "../lib/types";

interface TestEvent {
  id: string;
  dateIso: string;
  status: EventStatus;
}

describe("live tracking event directory", () => {
  it("keeps live and past events in separate sections", () => {
    const events: TestEvent[] = [
      { id: "upcoming", dateIso: "2026-11-10T00:00:00.000Z", status: "upcoming" },
      { id: "official", dateIso: "2026-10-10T00:00:00.000Z", status: "official" },
      { id: "live", dateIso: "2026-10-20T00:00:00.000Z", status: "live" },
      { id: "completed", dateIso: "2026-09-10T00:00:00.000Z", status: "completed" },
      { id: "provisional", dateIso: "2026-10-15T00:00:00.000Z", status: "provisional" },
    ];

    const grouped = groupLivePageEvents(events);

    expect(grouped.live.map((event) => event.id)).toEqual(["live"]);
    expect(grouped.upcoming.map((event) => event.id)).toEqual(["upcoming"]);
    expect(grouped.past.map((event) => event.id)).toEqual(["provisional", "official", "completed"]);
  });

  it("provides upcoming events when no event is live and still exposes past events", () => {
    const grouped = groupLivePageEvents<TestEvent>([
      { id: "upcoming-later", dateIso: "2026-11-10T00:00:00.000Z", status: "upcoming" },
      { id: "upcoming-next", dateIso: "2026-11-01T00:00:00.000Z", status: "upcoming" },
      { id: "past", dateIso: "2026-10-01T00:00:00.000Z", status: "completed" },
    ]);

    expect(grouped.live).toEqual([]);
    expect(grouped.upcoming.map((event) => event.id)).toEqual(["upcoming-next", "upcoming-later"]);
    expect(grouped.past.map((event) => event.id)).toEqual(["past"]);
  });
});
