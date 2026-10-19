import { describe, expect, it } from "vitest";

import { nearestPositionOnPath } from "./geo";

describe("nearestPositionOnPath", () => {
  it("snaps an off-course GPS coordinate onto the nearest route segment", () => {
    const position = nearestPositionOnPath(
      [
        { lat: 13, lng: 74 },
        { lat: 13, lng: 75 },
      ],
      { lat: 13.01, lng: 74.4 },
    );

    expect(position?.lat).toBeCloseTo(13, 8);
    expect(position?.lng).toBeCloseTo(74.4, 8);
  });

  it("clamps a GPS coordinate beyond the route to its endpoint", () => {
    const position = nearestPositionOnPath(
      [
        { lat: 13, lng: 74 },
        { lat: 13, lng: 75 },
      ],
      { lat: 13, lng: 76 },
    );

    expect(position).toEqual({ lat: 13, lng: 75 });
  });
});
