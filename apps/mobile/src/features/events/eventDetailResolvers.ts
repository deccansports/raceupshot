import type { LiveEventDto } from '@/core/types';
import type { LiveEventItem } from './hooks/useEvents';

type UnknownRecord = Record<string, unknown>;
type EventContent = LiveEventDto | LiveEventItem;

export type ResolvedCourse = {
	id: string;
	name: string;
	category: string | null;
	maps: UnknownRecord;
	ticket: UnknownRecord;
};

export type ResolvedCourses = {
	source: 'live-course-index' | 'ticket-definitions' | 'none';
	courses: ResolvedCourse[];
};

function asRecord(value: unknown): UnknownRecord | undefined {
	return value && typeof value === 'object' && !Array.isArray(value)
		? (value as UnknownRecord)
		: undefined;
}

function recordArray(value: unknown): UnknownRecord[] {
	return Array.isArray(value)
		? value.filter((item): item is UnknownRecord => Boolean(asRecord(item)))
		: [];
}

function firstText(...values: unknown[]): string | undefined {
	for (const value of values) {
		if (typeof value === 'string' && value.trim()) return value.trim();
	}
	return undefined;
}

function hasUsableRoute(value: unknown): boolean {
	if (typeof value === 'string') return /\.gpx(?:\?|$)/i.test(value.trim());
	if (Array.isArray(value)) return value.some(hasUsableRoute);
	const record = asRecord(value);
	if (!record) return false;
	return Object.entries(record).some(([key, candidate]) => {
		if (/(?:gpx|route|path|polyline|coordinates)/i.test(key)) {
			return typeof candidate === 'string' ? Boolean(candidate.trim()) : hasUsableRoute(candidate);
		}
		return Boolean(asRecord(candidate) || Array.isArray(candidate)) && hasUsableRoute(candidate);
	});
}

function toResolvedCourse(ticket: UnknownRecord, index: number): ResolvedCourse | null {
	const maps = asRecord(ticket.courseMaps) ?? asRecord(ticket.maps) ?? (hasUsableRoute(ticket) ? ticket : undefined);
	if (!maps || !hasUsableRoute(maps)) return null;
	const name = firstText(ticket.ticketName, ticket.name, ticket.contestName, ticket.title) ?? `Race Category ${index + 1}`;
	return {
		id: firstText(ticket.id, ticket.ticketId, ticket.contestId, ticket.providerContestUuid, name) ?? name,
		name,
		category: firstText(ticket.ticketCategory, ticket.category, ticket.categoryName) ?? null,
		maps,
		ticket,
	};
}

export function resolveTicketDefinitions(event: EventContent | null | undefined): UnknownRecord[] {
	if (!event) return [];
	const eventRecord = event as UnknownRecord;
	const raw = asRecord(event.raw);
	const data = asRecord(eventRecord.data);
	const candidates = [
		event.ticketDefinitions,
		eventRecord.contests,
		raw?.ticketDefinitions,
		raw?.contests,
		data?.ticketDefinitions,
		data?.contests,
	];
	for (const candidate of candidates) {
		const rows = recordArray(candidate);
		if (rows.length > 0) return rows;
	}
	return [];
}

export function resolveRulesHtml(event: EventContent | null | undefined): string | null {
	if (!event) return null;
	const eventRecord = event as UnknownRecord;
	const raw = asRecord(event.raw);
	const data = asRecord(eventRecord.data);
	return firstText(
		event.rulesAndRegulationsHtml,
		event.rulesContentHtml,
		event.rulesHtml,
		event.regulationsContentHtml,
		event.regulationsHtml,
		event.customRules,
		event.customRulesHtml,
		raw?.customRules,
		raw?.customRulesHtml,
		data?.customRules,
		data?.customRulesHtml,
	) ?? null;
}

export function resolveCourseMaps({
	liveCourseIndex,
	ticketDefinitions,
}: {
	liveCourseIndex: unknown;
	ticketDefinitions: UnknownRecord[];
}): ResolvedCourses {
	const liveRecord = asRecord(liveCourseIndex);
	const liveData = asRecord(liveRecord?.data);
	const courseIndex = asRecord(liveRecord?.courseIndex) ?? asRecord(liveData?.courseIndex);
	const timingConfiguration = asRecord(liveRecord?.timingConfiguration) ?? asRecord(liveData?.timingConfiguration);
	const liveCandidates = [
		liveRecord?.courses,
		liveData?.courses,
		liveRecord?.courseMaps,
		liveData?.courseMaps,
		courseIndex?.contests,
		timingConfiguration?.contests,
	];
	for (const candidate of liveCandidates) {
		const courses = recordArray(candidate)
			.map(toResolvedCourse)
			.filter((course): course is ResolvedCourse => Boolean(course));
		if (courses.length > 0) return { source: 'live-course-index', courses };
	}

	const courses = ticketDefinitions
		.map(toResolvedCourse)
		.filter((course): course is ResolvedCourse => Boolean(course));
	return {
		source: courses.length > 0 ? 'ticket-definitions' : 'none',
		courses,
	};
}

export function resolveLiveState(primaryEvent: EventContent, optionalLiveEvent: LiveEventDto | null | undefined) {
	const primary = primaryEvent as UnknownRecord;
	const live = (optionalLiveEvent ?? {}) as UnknownRecord;
	const liveTimingPoints = recordArray(live.timingPoints);
	const primaryTimingPoints = recordArray(primary.timingPoints);
	const liveGpxRoutes = recordArray(live.gpxRoutes);
	const primaryGpxRoutes = recordArray(primary.gpxRoutes);

	return {
		liveTracking: asRecord(live.liveTracking) ?? asRecord(primary.liveTracking) ?? null,
		liveTrackingEnabled:
			typeof live.liveTrackingEnabled === 'boolean'
				? live.liveTrackingEnabled
				: typeof primary.liveTrackingEnabled === 'boolean'
					? primary.liveTrackingEnabled
					: false,
		timingConfigurationSummary: live.timingConfigurationSummary ?? primary.timingConfigurationSummary ?? null,
		timingPoints: liveTimingPoints.length > 0 ? liveTimingPoints : primaryTimingPoints,
		mapsSplitsConfig: live.mapsSplitsConfig ?? primary.mapsSplitsConfig ?? null,
		gpxRoutes: liveGpxRoutes.length > 0 ? liveGpxRoutes : primaryGpxRoutes,
	};
}
