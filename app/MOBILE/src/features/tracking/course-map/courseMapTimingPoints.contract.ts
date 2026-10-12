import type {
  CourseGeometry,
  ResolvedTimingConfiguration,
} from '@/core/types';

import {
  coursePathDistanceKm,
  mapCourseMap,
  normalizeTimingPointDisplayConfig,
} from './mappers';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Course-map timing-point contract failed: ${message}`);
}

const points = {
  '9D4e7dtZ': { pointId: '9D4e7dtZ', label: 'Swim', course: 'swim', km: 0.1, visible: true },
  '5a9oghhr': { pointId: '5a9oghhr', label: 'Bike Start / T1 / T2 / Run Finish', course: 'bike', km: 0.15, visible: true },
  '2Oh0UwBi': { pointId: '2Oh0UwBi', label: 'Bike Turn 1', course: 'bike', km: 9.2, visible: true },
  '3ifivyzz': { pointId: '3ifivyzz', label: 'Bike Turn 2', course: 'bike', km: 19, visible: true },
  '23kJeJpt': { pointId: '23kJeJpt', label: 'Run Turn 1', course: 'run', km: 2.5, visible: true },
  'fErd1fjQ': { pointId: 'fErd1fjQ', label: 'Run Turn 2', course: 'run', km: 4, visible: true },
  '3ITVi9DD': { pointId: '3ITVi9DD', label: 'FINISH', course: 'finish', km: 0.125, visible: true },
};

const geometry: CourseGeometry = {
  contestId: 'ticket-102',
  name: 'Bergman 102 Triathlon',
  legs: [
    { segment: 'swim', path: [{ lat: 0, lng: 0 }, { lat: 0, lng: 0.01 }] },
    { segment: 'bike', path: [{ lat: 1, lng: 0 }, { lat: 1, lng: 0.2 }] },
    { segment: 'run', path: [{ lat: 2, lng: 0 }, { lat: 2, lng: 0.1 }] },
  ],
  markers: [],
};

function timingConfiguration(
  overrides: Record<string, unknown> = {},
): ResolvedTimingConfiguration {
  return {
    eventId: '4cEm8JPYbpupoFRMDLc1',
    contests: [],
    timingPointDisplayConfig: {
      points: { ...points, ...overrides },
    },
  };
}

export function runCourseMapTimingPointContract(): true {
  const normalized = normalizeTimingPointDisplayConfig(timingConfiguration());
  assert(normalized.length === 7, 'exactly seven configured points');
  assert(normalized.map((point) => point.id).join(',') === Object.keys(points).join(','), 'admin order is stable');

  const first = mapCourseMap(undefined, geometry, { id: 'ticket-102' }, timingConfiguration());
  assert(first, 'map must resolve');
  const timingMarkers = first.markers.filter((marker) => marker.source === 'timing-point-display');
  assert(timingMarkers.length === 7, 'exactly seven timing markers render');
  assert(timingMarkers.map((marker) => marker.label).join(',') === Object.values(points).map((point) => point.label).join(','), 'saved labels render unchanged');
  assert(!first.markers.some((marker) => marker.source === ('race-flow' as never)), 'Race Flow markers are absent');
  assert(!first.markers.some((marker) => ['Start', 'T1', 'T2'].includes(marker.label)), 'synthetic markers are absent');

  const bikeTurn = timingMarkers.find((marker) => marker.sourceId === '2Oh0UwBi');
  const runTurn = timingMarkers.find((marker) => marker.sourceId === '23kJeJpt');
  assert(bikeTurn && Math.abs(coursePathDistanceKm([geometry.legs[1].path[0], bikeTurn.position]) - 9.2) < 0.02, 'Bike Turn 1 is 9.2 KM along bike GPX');
  assert(runTurn && Math.abs(coursePathDistanceKm([geometry.legs[2].path[0], runTurn.position]) - 2.5) < 0.02, 'Run Turn 1 is 2.5 KM along run GPX');

  const hidden = mapCourseMap(
    undefined,
    geometry,
    { id: 'ticket-102' },
    timingConfiguration({ '23kJeJpt': { ...points['23kJeJpt'], visible: false } }),
  );
  assert(hidden?.markers.filter((marker) => marker.source === 'timing-point-display').length === 6, 'hidden point is removed');

  const repeated = mapCourseMap(undefined, geometry, { id: 'ticket-102' }, timingConfiguration());
  assert(repeated?.markers.map((marker) => marker.id).join(',') === first.markers.map((marker) => marker.id).join(','), 'refresh never duplicates or reorders markers');

  const moved = mapCourseMap(
    undefined,
    geometry,
    { id: 'ticket-102' },
    timingConfiguration({ '2Oh0UwBi': { ...points['2Oh0UwBi'], km: 10 } }),
  );
  const movedTimingMarkers = moved?.markers.filter((marker) => marker.source === 'timing-point-display') ?? [];
  const changedMarkerIds = timingMarkers
    .filter((marker) => {
      const next = movedTimingMarkers.find((candidate) => candidate.sourceId === marker.sourceId);
      return !next || next.position.lat !== marker.position.lat || next.position.lng !== marker.position.lng;
    })
    .map((marker) => marker.sourceId);
  assert(changedMarkerIds.join(',') === '2Oh0UwBi', 'changing a KM moves only the matching Feibot timing point');

  const noConfig = mapCourseMap(undefined, geometry, { id: 'ticket-102' }, {
    eventId: '4cEm8JPYbpupoFRMDLc1',
    contests: [],
  });
  assert(!noConfig?.markers.some((marker) => marker.source === 'timing-point-display'), 'missing config renders route without timing points');

  const swimOnlyGeometry: CourseGeometry = {
    contestId: 'swim-ticket',
    name: 'Swimathon',
    legs: [geometry.legs[0]],
    markers: [],
  };
  const splitPoint = mapCourseMap(
    undefined,
    swimOnlyGeometry,
    { id: 'swim-ticket' },
    timingConfiguration({
      '100m': { pointId: '100m', label: '100 MTRS', course: 'split', km: 0.1, visible: true },
    }),
  );
  const genericSplitMarker = splitPoint?.markers.find((marker) => marker.sourceId === '100m');
  assert(genericSplitMarker?.kind === 'timing', 'generic split point renders on a single-discipline course');
  return true;
}
