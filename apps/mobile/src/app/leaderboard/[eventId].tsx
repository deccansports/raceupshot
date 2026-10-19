import { Redirect, useLocalSearchParams } from 'expo-router';

import { safeRouteEventId } from '@/features/events/utils/eventRoute';

export default function LeaderboardRouteRedirect() {
	const { eventId } = useLocalSearchParams<{ eventId: string | string[] }>();
	const id = safeRouteEventId(eventId);
	return <Redirect href={id ? `/event/${id}/leaderboard` : '/'} />;
}
