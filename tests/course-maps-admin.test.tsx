// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CourseMapsAdmin } from "@/components/course-maps-admin";
import type { EventCourseCollection } from "@/packages/contracts/src";

vi.mock("@/components/google-course-map", () => ({
  GoogleCourseMap: ({ maps }: { maps: unknown[] }) => <div data-testid="google-map">{maps.length} routes</div>,
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("CourseMapsAdmin persistence", () => {
  it("reloads the persisted event-scoped collection when the tab is reopened", async () => {
    const persisted: EventCourseCollection = {
      eventId: "event-1",
      updatedAt: "2026-08-26T11:37:03.930Z",
      maps: [{
        mapId: "map-1",
        eventId: "event-1",
        category: "Overall",
        mapName: "Saved Race Course",
        mapType: "RACE_COURSE",
        fileName: "saved-route.gpx",
        points: [
          { latitude: 18.5204, longitude: 73.8567 },
          { latitude: 18.5304, longitude: 73.8667 },
        ],
        routeColor: "#1768ac",
        visibility: { web: true, mobile: true, public: true },
        displayOrder: 0,
        updatedAt: "2026-08-26T11:37:03.930Z",
      }],
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, data: persisted }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<CourseMapsAdmin
      eventId="event-1"
      eventName="Test Event"
      sport="Running"
      categories={["Overall"]}
      initialCollection={{ eventId: "event-1", maps: [], updatedAt: null }}
    />);

    await waitFor(() => expect(screen.getByText("Saved Race Course")).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/events/event-1/course-maps",
      expect.objectContaining({ cache: "no-store" }),
    );
    expect(screen.getAllByTestId("google-map").at(-1)?.textContent).toBe("1 routes");
  });
});
