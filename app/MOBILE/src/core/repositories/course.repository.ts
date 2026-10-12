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

export interface ICourseRepository {
  getCourseIndex(eventId: string, signal?: AbortSignal): Promise<CourseIndexResponse>;
  getCourseMap(eventId: string, signal?: AbortSignal): Promise<CourseMapResponse>;
  getCourseMapResources(eventId: string, signal?: AbortSignal): Promise<CourseMapResources>;
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

function sanitizeCourseConfigResponse(response: Record<string, unknown>): Record<string, unknown> {
  const course = response.course && typeof response.course === 'object'
    ? response.course as Record<string, unknown>
    : null;
  return {
    ...response,
    legs: sanitizeLegArray(response.legs),
    ...(course ? { course: { ...course, legs: sanitizeLegArray(course.legs) } } : {}),
  };
}

function unwrapRecordResponse(response: unknown): Record<string, unknown> {
  const envelope = response && typeof response === 'object' && !Array.isArray(response)
    ? response as Record<string, unknown>
    : {};
  const data = envelope.data && typeof envelope.data === 'object' && !Array.isArray(envelope.data)
    ? envelope.data as Record<string, unknown>
    : {};
  return Object.keys(data).length > 0 ? { ...envelope, ...data } : envelope;
}

function normalizeCanonicalCourseResponse(
  eventId: string,
  raw: unknown,
): CourseIndexResponse | null {
  const envelope = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : {};
  const data = envelope.data && typeof envelope.data === 'object' && !Array.isArray(envelope.data)
    ? envelope.data as Record<string, unknown>
    : {};
  const contests = Array.isArray(data.contests)
    ? data.contests.filter((value): value is Record<string, unknown> =>
        Boolean(value) && typeof value === 'object' && !Array.isArray(value),
      )
    : [];
  if (contests.length === 0) return null;

  const normalized = contests.map((contest) => {
    const contestId = text(contest.providerContestUuid ?? contest.contestUuid ?? contest.id);
    const contestName = text(contest.displayName ?? contest.contestName ?? contest.name) || contestId;
    const rawSplits = Array.isArray(contest.splits) ? contest.splits : [];
    const timingPoints = rawSplits.map((value, index) => {
      const split = value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
      const isStart = split.isStart === true;
      const isFinish = split.isFinish === true;
      return {
        ...split,
        id: text(split.key ?? split.providerSplitId ?? split.id) || `split-${index + 1}`,
        label: text(split.displayName ?? split.providerName ?? split.name) || `Split ${index + 1}`,
        markerType: isStart ? 'start' : isFinish ? 'finish' : text(split.legType) || 'split',
        order: Number(split.order) || index + 1,
        distanceKm: Number(split.cumulativeDistanceKm ?? split.distanceKm) || 0,
      };
    });
    const legs = (Array.isArray(contest.legs) ? contest.legs : []).map((value) => {
      const leg = value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
      const urls = Array.isArray(leg.gpxUrls) ? leg.gpxUrls : [];
      return {
        ...leg,
        segment: text(leg.type ?? leg.key ?? leg.legType) || 'course',
        distanceKm: Number(leg.distanceKm) || undefined,
        gpxUrl: text(
          leg.gpxUrl ??
            leg.gpx_url ??
            leg.routeUrl ??
            leg.route_url ??
            leg.mapUrl ??
            leg.map_url ??
            urls[0],
        ) || undefined,
      };
    });
    return {
      raw: contest,
      contestId,
      contestName,
      timingPoints,
      legs,
      splits: timingPoints.map((point) => ({
        ...point,
        name: point.label,
      })),
    };
  });

  return {
    success: envelope.success !== false,
    eventId: text(envelope.eventId ?? data.eventId) || eventId,
    timingConfiguration: {
      eventId,
      updatedAt: text(data.updatedAt) || undefined,
      contests: normalized.map(({ raw, ...contest }) => ({ ...raw, ...contest })),
    } as ResolvedTimingConfiguration,
    courseIndex: {
      eventId,
      contests: normalized.map(({ raw, contestName, ...contest }) => ({
        ...raw,
        ...contest,
        name: contestName,
      })),
    } as CourseIndex,
  };
}

async function loadCourseIndex(eventId: string, signal?: AbortSignal): Promise<CourseIndexResponse> {
  try {
    const canonical = await liveApi.json<unknown>(
      `/api/live/events/${eventId}/canonical/course`,
      { signal, timeoutMs: 3_500 },
    );
    const normalized = normalizeCanonicalCourseResponse(eventId, canonical);
    if (normalized) return sanitizeCourseIndexResponse(normalized);
  } catch (error) {
    if (signal?.aborted) throw error;
    // Do not follow a canonical timeout with the 459 KB legacy payload on a
    // weak connection. The fallback is only for an actual endpoint failure.
    if ((error as { name?: string } | undefined)?.name === 'AbortError') throw error;
  }
  const legacy = await liveApi.json<CourseIndexResponse>(`/api/live/course-index/${eventId}`, { signal });
  return sanitizeCourseIndexResponse(unwrapRecordResponse(legacy) as CourseIndexResponse);
}

async function loadCourseMap(eventId: string, signal?: AbortSignal): Promise<CourseMapResponse> {
  const raw = await liveApi.json<CourseMapResponse>(`/api/live/course-map/${eventId}`, {
    signal,
  });
  return sanitizeCourseConfigResponse(unwrapRecordResponse(raw)) as CourseMapResponse;
}

export const ProductionCourseRepository: ICourseRepository = {
  async getCourseIndex(eventId, signal) {
    return loadCourseIndex(eventId, signal);
  },
  async getCourseMap(eventId, signal) {
    return loadCourseMap(eventId, signal);
  },
  async getCourseMapResources(eventId, signal) {
    const [courseMapResult, courseIndexResult] = await Promise.allSettled([
      loadCourseMap(eventId, signal),
      loadCourseIndex(eventId, signal),
    ]);
    // The event course-map endpoint is an independent, valid source of GPX
    // geometry. Do not discard it merely because the larger canonical course
    // index timed out on a mobile connection. This previously left the map
    // query in an error state and rendered the misleading "published closer
    // to race day" placeholder even though all GPX URLs were configured.
    if (
      courseIndexResult.status === 'rejected' &&
      courseMapResult.status === 'rejected'
    ) {
      throw courseIndexResult.reason;
    }
    const courseIndex = courseIndexResult.status === 'fulfilled'
      ? courseIndexResult.value
      : { success: false, eventId };
    const courseMap = courseMapResult.status === 'fulfilled'
      ? courseMapResult.value
      : { success: false, eventId };
    return { ...courseIndex, courseMap };
  },
  async getCourseConfig(eventId, signal) {
    return loadCourseMap(eventId, signal);
  },
};
