import { Redirect, useLocalSearchParams } from 'expo-router';

import { useEvent } from '@/features/events/hooks/useEvents';
import { safeRouteEventId } from '@/features/events/utils/eventRoute';

export default function CourseRouteRedirect() {
	const { eventId } = useLocalSearchParams<{ eventId: string | string[] }>();
	const id = safeRouteEventId(eventId);
	const { event, isLoading } = useEvent(id ?? '');
	if (isLoading) {
		return null;
	}
	if (event?.status === 'finished') {
		return <Redirect href={id ? `/event/${id}/results` : '/'} />;
	}
	return <Redirect href={id ? `/event/${id}/track` : '/'} />;
}
