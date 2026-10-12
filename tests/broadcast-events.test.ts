import { describe, expect, it } from "vitest";
import { orderBroadcastEvents } from "../lib/broadcast-events";

describe("Broadcast event availability", () => {
  const now = new Date("2026-08-01T12:00:00.000Z");

  it("keeps past events available for camera and Stream setup", () => {
    const events = orderBroadcastEvents([
      { id: "past", dateIso: "2026-07-10T00:00:00.000Z", status: "past" },
    ], now);

    expect(events.map((event) => event.id)).toEqual(["past"]);
  });

  it("orders live and upcoming events before past events", () => {
    const events = orderBroadcastEvents([
      { id: "older", dateIso: "2026-05-01T00:00:00.000Z", status: "past" },
      { id: "upcoming-later", dateIso: "2026-09-01T00:00:00.000Z", status: "upcoming" },
      { id: "live", dateIso: "2026-07-01T00:00:00.000Z", status: "live" },
      { id: "recent", dateIso: "2026-07-20T00:00:00.000Z", status: "past" },
      { id: "upcoming-sooner", dateIso: "2026-08-10T00:00:00.000Z", status: "upcoming" },
    ], now);

    expect(events.map((event) => event.id)).toEqual([
      "live",
      "upcoming-sooner",
      "upcoming-later",
      "recent",
      "older",
    ]);
  });
});
