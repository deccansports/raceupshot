import { liveApi } from '@/core/services/api';
import type { CourseIndex, ResolvedTimingConfiguration } from '@/core/types';

export type CourseIndexResponse = {
  success: boolean;
  eventId: string;
  timingConfiguration?: ResolvedTimingConfiguration;
  courseIndex?: CourseIndex;
  message?: string;
};

export type CourseMapResponse = Record<string, unknown> & {
  success?: boolean;
  eventId?: string;
  ticketDefinitions?: Record<string, unknown>[];
};

export type CourseMapResources = CourseIndexResponse & {
  courseMap: CourseMapResponse;
};

export type CourseMapRequest = {
  ticketId?: string;
  contestId?: string;
  contestName?: string;
};

export interface ICourseRepository {
  getCourseIndex(eventId: string, signal?: AbortSignal): Promise<CourseIndexResponse>;
  getCourseMap(eventId: string, signal?: AbortSignal, selection?: CourseMapRequest): Promise<CourseMapResponse>;
  getCourseMapResources(eventId: string, signal?: AbortSignal, selection?: CourseMapRequest, includeGeometry?: boolean): Promise<CourseMapResources>;
  getCourseConfig(eventId: string, signal?: AbortSignal): Promise<Record<string, unknown>>;
}

function text(value: unknown): string {
  return String(value ?? '').trim();
}

function readableLegLabel(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const label = text(value);
    return label && label.toLowerCase() !== '[object object]' ? label : undefined;
  }
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  const label = text(
    record.name ??
      record.label ??
      record.code ??
      record.type ??
      record.leg ??
      record.legName ??
      record.legType ??
      record.title ??
      record.segment ??
      record.sport,
  );
  if (!label || label.toLowerCase() === '[object object]') return undefined;
  const normalized = label.trim().toUpperCase().replace(/[\s_-]+/g, '');
  if (normalized.includes('SWIM')) return 'SWIM';
  if (normalized === 'T1' || normalized.includes('TRANSITION1') || normalized.includes('TRANSITIONONE')) return 'T1';
  if (normalized.includes('BIKE') || normalized.includes('CYCLE')) return 'BIKE';
  if (normalized === 'T2' || normalized.includes('TRANSITION2') || normalized.includes('TRANSITIONTWO')) return 'T2';
  if (normalized.includes('RUN')) return 'RUN';
  if (normalized.includes('FINISH')) return 'FINISH';
  return undefined;
}

function sanitizeLegArray(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  const seen = new Set<string>();
  return value
    .map(readableLegLabel)
    .filter((label): label is string => Boolean(label))
    .filter((label) => {
      const key = label.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function sanitizeCourseIndexResponse(response: CourseIndexResponse): CourseIndexResponse {
  const timingConfiguration = response.timingConfiguration as (ResolvedTimingConfiguration & Record<string, unknown>) | undefined;
  const courseIndex = response.courseIndex as (CourseIndex & Record<string, unknown>) | undefined;

  const course = timingConfiguration?.course && typeof timingConfiguration.course === 'object'
    ? timingConfiguration.course as Record<string, unknown>
    : null;
  const indexCourse = courseIndex?.course && typeof courseIndex.course === 'object'
    ? courseIndex.course as Record<string, unknown>
    : null;

  return {
    ...response,
    ...(timingConfiguration && typeof timingConfiguration === 'object'
      ? {
          timingConfiguration: {
            ...timingConfiguration,
            legs: sanitizeLegArray(timingConfiguration.legs),
            ...(course ? { course: { ...course, legs: sanitizeLegArray(course.legs) } } : {}),
          } as ResolvedTimingConfiguration,
        }
      : {}),
    ...(courseIndex && typeof courseIndex === 'object'
      ? {
          courseIndex: {
            ...courseIndex,
            legs: sanitizeLegArray(courseIndex.legs),
            ...(indexCourse ? { course: { ...indexCourse, legs: sanitizeLegArray(indexCourse.legs) } } : {}),
          } as CourseIndex,
        }
      : {}),
  };
}

function courseIndexFromMap(eventId: string, courseMap: CourseMapResponse): CourseIndexResponse {
  const contests = Array.isArray(courseMap.ticketDefinitions)
    ? courseMap.ticketDefinitions
    : [];
  const timingConfiguration = courseMap.timingConfiguration && typeof courseMap.timingConfiguration === 'object'
    ? courseMap.timingConfiguration as Record<string, unknown>
    : {};
  const canonicalContests = Array.isArray(timingConfiguration.contests)
    ? timingConfiguration.contests
    : contests;
  return sanitizeCourseIndexResponse({
    success: courseMap.success !== false,
    eventId,
    timingConfiguration: {
      ...timingConfiguration,
      eventId,
      contests: canonicalContests,
    } as ResolvedTimingConfiguration,
    courseIndex: {
      eventId,
      contests: canonicalContests,
    } as CourseIndex,
  });
}

async function loadCourseIndex(eventId: string, signal?: AbortSignal): Promise<CourseIndexResponse> {
  return courseIndexFromMap(eventId, await loadCourseMap(eventId, signal, undefined, false));
}

async function loadCourseMap(eventId: string, signal?: AbortSignal, selection?: CourseMapRequest, includeGeometry = true): Promise<CourseMapResponse> {
  try {
    const requestCourse = async (requestedSelection?: CourseMapRequest) => {
      const query = new URLSearchParams({ surface: 'mobile', geometry: includeGeometry ? '1' : '0' });
      if (text(requestedSelection?.ticketId)) query.set('ticketId', text(requestedSelection?.ticketId));
      if (text(requestedSelection?.contestId)) query.set('contestId', text(requestedSelection?.contestId));
      if (text(requestedSelection?.contestName)) query.set('category', text(requestedSelection?.contestName));
      return liveApi.json<{ success?: boolean; data?: Record<string, unknown> }>(
        `/api/v1/events/${encodeURIComponent(eventId)}/course?${query.toString()}`,
        { signal },
      );
    };
    let raw = await requestCourse(selection);
    let data = raw.data && typeof raw.data === 'object' ? raw.data : {};
    const selectionWasScoped = Boolean(
      text(selection?.ticketId) ||
      text(selection?.contestId) ||
      text(selection?.contestName),
    );
    // A participant can retain its former provider contest UUID while an
    // event is republished with a new contest mapping. The scoped API then
    // correctly returns no match, but the event's public default course is
    // still usable and must remain visible while tracking that athlete.
    if (selectionWasScoped && (!Array.isArray(data.maps) || data.maps.length === 0)) {
      raw = await requestCourse();
      data = raw.data && typeof raw.data === 'object' ? raw.data : {};
    }
    const maps = Array.isArray(data.maps) ? data.maps.filter((value): value is Record<string, unknown> => Boolean(value) && typeof value === 'object') : [];
    const routeKeys = [...new Set(maps.map((map) => text(map.ticketId) || text(map.category) || 'Overall'))];
    const gpxUrl = (map: Record<string, unknown>) => {
      // Public course responses deliberately omit the stored GPX body and
      // expose its trusted file URL instead. Prefer that URL; otherwise every
      // published course is reduced to an empty route on mobile.
      const publishedUrl = text(map.gpxUrl);
      if (publishedUrl) return publishedUrl;
      const xml = text(map.gpxData);
      if (xml) return `data:application/gpx+xml;charset=utf-8,${encodeURIComponent(xml)}`;
      return '';
    };
    const ticketDefinitions = routeKeys.map((routeKey) => {
      const categoryMaps = maps.filter((map) => (text(map.ticketId) || text(map.category) || 'Overall') === routeKey);
      const representative = categoryMaps[0] ?? {};
      const category = text(representative.category) || routeKey;
      const courseMaps: Record<string, unknown> = {};
      for (const map of categoryMaps) {
        const type = text(map.mapType).toUpperCase();
        const url = gpxUrl(map);
        const points = Array.isArray(map.points) ? map.points : [];
        if (!url && points.length < 2) continue;
        if (type === 'SWIM') {
          if (url) courseMaps.swimGpxUrl = url;
          if (points.length > 1) courseMaps.swimPoints = points;
        } else if (type === 'BIKE') {
          if (url) courseMaps.bikeGpxUrl = url;
          if (points.length > 1) courseMaps.bikePoints = points;
        } else if (type === 'RUN_1') {
          if (url) courseMaps.run1GpxUrl = url;
          if (points.length > 1) courseMaps.run1Points = points;
        } else if (type === 'RUN_2') {
          if (url) courseMaps.run2GpxUrl = url;
          if (points.length > 1) courseMaps.run2Points = points;
        } else {
          if (url) courseMaps.runGpxUrl = url;
          if (points.length > 1) courseMaps.runPoints = points;
        }
      }
      return {
        id: text(representative.ticketId) || routeKey,
        name: category,
        ticketName: category,
        providerContestUuid: text(representative.providerContestUuid) || undefined,
        courseMaps,
      };
    });
    return { success: raw.success, eventId, ...data, ticketDefinitions };
  } catch (error) {
    if (signal?.aborted) throw error;
    throw error;
  }
}

export const ProductionCourseRepository: ICourseRepository = {
  async getCourseIndex(eventId, signal) {
    return loadCourseIndex(eventId, signal);
  },
  async getCourseMap(eventId, signal, selection) {
    return loadCourseMap(eventId, signal, selection, Boolean(selection));
  },
  async getCourseMapResources(eventId, signal, selection, includeGeometry = false) {
    // One response contains both timing metadata and the selected course.
    // Unscoped screens receive metadata only; athlete tracking receives only
    // the selected ticket/contest geometry instead of every event route.
    const courseMap = await loadCourseMap(eventId, signal, selection, includeGeometry);
    return { ...courseIndexFromMap(eventId, courseMap), courseMap };
  },
  async getCourseConfig(eventId, signal) {
    return loadCourseMap(eventId, signal);
  },
};
