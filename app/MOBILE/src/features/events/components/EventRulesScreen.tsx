import { Pressable, ScrollView, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useTheme } from '@/core/theme';
import { queryKeys } from '@/core/services/query/queryKeys';
import { repositories } from '@/core/repositories';
import { Badge, Button, Card, ErrorState, Icon, Skeleton, Text } from '@/shared/components';

import { EventHtmlContent } from './EventHtmlContent';
import { useEvent } from '../hooks/useEvents';
import { safeRouteEventId } from '../utils/eventRoute';

export function EventRulesScreen() {
	const theme = useTheme();
	const router = useRouter();
	const { eventId } = useLocalSearchParams<{ eventId: string | string[] }>();
	const id = safeRouteEventId(eventId) ?? '';
	const { event, isLoading, refetch } = useEvent(id);

	const rulesQuery = useQuery({
		queryKey: queryKeys.events.rules(id),
		queryFn: () => repositories.events.getEventRules(id),
		enabled: Boolean(id) && !event?.customRules,
		retry: false,
		staleTime: 5 * 60_000,
	});

	const rulesHtml = event?.customRules ?? event?.customRulesHtml ?? rulesQuery.data ?? null;

	const handleBackPress = () => {
		router.replace(id ? `/event/${id}` : '/events');
	};

	if (isLoading) {
		return (
			<SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }}>
				<View style={{ padding: theme.spacing.base, gap: theme.spacing.md }}>
					<Skeleton height={56} radius={theme.radius.large} />
					<Skeleton height={260} radius={theme.radius.large} />
				</View>
			</SafeAreaView>
		);
	}

	if (!event) {
		return (
			<SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }}>
				<View style={{ padding: theme.spacing.base }}>
					<ErrorState title="Rules unavailable" description="We couldn't load this event." onRetry={refetch} />
				</View>
			</SafeAreaView>
		);
	}

	return (
		<SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }} edges={['top', 'left', 'right']}>
			<ScrollView
				contentContainerStyle={{ padding: theme.spacing.base, gap: theme.spacing.lg, paddingBottom: theme.spacing.xxl }}
				showsVerticalScrollIndicator={false}>
				<View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.spacing.sm }}>
					<Pressable
						accessibilityRole="button"
						accessibilityLabel="Go back"
						onPress={handleBackPress}
						style={{
							width: 40,
							height: 40,
							borderRadius: 20,
							backgroundColor: theme.colors.surface,
							alignItems: 'center',
							justifyContent: 'center',
							...theme.shadows.card,
						}}>
						<Icon name="chevronLeft" />
					</Pressable>
					<Badge label="Rules" variant="neutral" />
				</View>

				<View style={{ gap: theme.spacing.xs }}>
					<Text variant="display">Rules & Regulations</Text>
					<Text variant="bodySmall" color="textMuted">
						{event.name}
					</Text>
				</View>

				<Card style={{ gap: theme.spacing.md, overflow: 'hidden' }}>
					{rulesQuery.isLoading ? (
						<Skeleton height={280} radius={theme.radius.large} />
					) : rulesHtml ? (
						<EventHtmlContent html={rulesHtml} />
					) : (
						<Text variant="body" color="textMuted">
							No rules content was supplied for this event.
						</Text>
					)}
				</Card>

				<Button label="Back to event" fullWidth onPress={() => router.replace(id ? `/event/${id}` : '/events')} />
			</ScrollView>
		</SafeAreaView>
	);
}

export default EventRulesScreen;
