import assert from "node:assert/strict";
import test from "node:test";

import { resolveCourseGeometry } from "./courseConfig";

test("published coordinate arrays render without refetching a GPX file", async () => {
  let fetchCount = 0;
  const geometry = await resolveCourseGeometry(
    {
      ticketDefinitions: [{
        id: "Triathlon",
        name: "Triathlon",
        courseMaps: {
          swimPoints: [
            { latitude: 12.812484, longitude: 77.377202, elevation: 737.1 },
            { latitude: 12.813199, longitude: 77.376511, elevation: 732 },
          ],
          bikePoints: [
            { latitude: 12.80913, longitude: 77.37793 },
            { latitude: 12.80858, longitude: 77.37805 },
          ],
        },
      }],
    },
    async () => {
      fetchCount += 1;
      throw new Error("coordinate-backed maps must not fetch GPX");
    },
    { contestId: "4P5nn2hp", contestName: "Triathlon" },
  );

  assert.equal(fetchCount, 0);
  assert.equal(geometry?.legs.length, 2);
  assert.deepEqual(geometry?.legs[0].path[0], {
    lat: 12.812484,
    lng: 77.377202,
    ele: 737.1,
  });
  assert.equal(geometry?.legs[0].loadError, false);
});

test("tracked athlete resolves only the matching ticket geometry", async () => {
  const geometry = await resolveCourseGeometry(
    {
      ticketDefinitions: [
        {
          id: "sprint",
          name: "Sprint",
          providerContestUuid: "contest-sprint",
          courseMaps: { runPoints: [{ latitude: 1, longitude: 1 }, { latitude: 2, longitude: 2 }] },
        },
        {
          id: "olympic",
          name: "Olympic",
          providerContestUuid: "contest-olympic",
          courseMaps: { runPoints: [{ latitude: 10, longitude: 10 }, { latitude: 20, longitude: 20 }] },
        },
      ],
    },
    async () => { throw new Error("coordinate-backed course must not fetch"); },
    { contestId: "contest-olympic", contestName: "Olympic" },
  );

  assert.equal(geometry?.contestId, "olympic");
  assert.deepEqual(geometry?.legs[0].path[0], { lat: 10, lng: 10 });
});
