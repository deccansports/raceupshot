import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useTheme } from '@/core/theme';
import {
  EmptyState,
  ErrorState,
  EventCard,
  SearchBar,
  Skeleton,
  TabBar,
  Text,
} from '@/shared/components';
import { useResponsive } from '@/shared/hooks';

import { selectEvents, useEvents, type EventTab, type LiveEventItem } from '../hooks/useEvents';
import { safeRouteEventId } from '../utils/eventRoute';

export function EventsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { isTablet } = useResponsive();
  const { events, isLoading, isError, isRefreshing, refetch } = useEvents();

  const [selectedTab, setSelectedTab] = useState<EventTab | null>(null);
  const [search, setSearch] = useState('');
  const defaultTab: EventTab = events.some((event) => event.status === 'live')
    ? 'live'
    : events.some((event) => event.status === 'upcoming')
      ? 'upcoming'
      : events.some((event) => event.status === 'finished')
        ? 'completed'
        : 'live';
  const tab = selectedTab ?? defaultTab;

  const filtered = useMemo(() => selectEvents(events, tab, search), [events, tab, search]);

  const renderItem = ({ item }: { item: LiveEventItem }) => (
    <EventCard
      title={item.name}
      dateLabel={item.dateLabel}
      location={item.location}
      status={item.status}
      discipline={item.discipline}
      distances={item.distances}
      imageUri={item.imageUri}
      onPress={() => {
        const eventId = safeRouteEventId(item.eventId, item.id);
        if (!eventId) return;
        router.push({ pathname: '/event/[eventId]', params: { eventId } });
      }}
    />
  );

  const header = (
    <View style={{ gap: theme.spacing.md, paddingBottom: theme.spacing.md }}>
      <Text variant="display">Events</Text>
      <SearchBar value={search} onChangeText={setSearch} placeholder="Search events" />
      <TabBar
        items={[
          { key: 'live', label: 'Live' },
          { key: 'upcoming', label: 'Upcoming' },
          { key: 'completed', label: 'Completed' },
        ]}
        activeKey={tab}
        onChange={(k) => setSelectedTab(k as EventTab)}
      />
    </View>
  );

  const contentStyle = {
    padding: theme.spacing.base,
    gap: theme.spacing.md,
    maxWidth: isTablet ? theme.maxContentWidth : undefined,
    alignSelf: 'center' as const,
    width: '100%' as const,
    flexGrow: 1,
  };

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: theme.colors.background }}
      edges={['top', 'left', 'right']}>
      {isLoading ? (
        <View style={{ padding: theme.spacing.base, gap: theme.spacing.md }}>
          {header}
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} height={120} radius={theme.radius.large} />
          ))}
        </View>
      ) : isError ? (
        <View style={{ padding: theme.spacing.base }}>
          {header}
          <ErrorState description="We couldn't load events." onRetry={() => refetch()} />
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          ListHeaderComponent={header}
          ListEmptyComponent={
            <EmptyState
              title="No events here"
              description={
                tab === 'live'
                  ? 'There are no live events right now.'
                  : 'Nothing to show for this tab yet.'
              }
            />
          }
          contentContainerStyle={contentStyle}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={refetch}
              tintColor={theme.colors.accent}
            />
          }
        />
      )}
    </SafeAreaView>
  );
}
