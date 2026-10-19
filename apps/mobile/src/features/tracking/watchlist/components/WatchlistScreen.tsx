import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useTheme } from '@/core/theme';
import { useEvents } from '@/features/events/hooks/useEvents';
import { useAthleteSearch, useParticipants } from '@/features/tracking/hooks';
import {
  Avatar,
  Card,
  EmptyState,
  Icon,
  ListItem,
  SearchBar,
  Skeleton,
  Text,
} from '@/shared/components';
import { useDebouncedValue, useResponsive } from '@/shared/hooks';

import { useWatchlist } from '../hooks/useWatchlist';

export function WatchlistScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { isTablet } = useResponsive();
  const { events } = useEvents();
  const [search, setSearch] = useState('');
  const debounced = useDebouncedValue(search, 200);
  const searchEvent = useMemo(
    () => events.find((e) => e.status === 'live') ?? events.find((e) => e.status !== 'finished'),
    [events],
  );
  const participantRoster = useParticipants(
    searchEvent?.id ?? '',
    Boolean(searchEvent?.id),
  );
  const roster = useMemo(
    () => (Array.isArray(participantRoster.data) ? participantRoster.data : []),
    [participantRoster.data],
  );
  const { ids, athletes, addAthlete, isWatched } = useWatchlist(
    searchEvent?.id,
    roster as Record<string, unknown>[],
  );
  const athleteSearch = useAthleteSearch(
    searchEvent?.id ?? '',
    debounced,
    'name',
    Boolean(searchEvent),
    'live',
  );

  const openAthlete = (athlete: { bib: string; eventId?: string; participantUuid?: string; providerUuid?: string; providerTimingUuid?: string; providerRecordId?: string; athleteUid?: string; bookingId?: string }) =>
    router.push({
      pathname: '/athletes/[bib]',
      params: {
        bib: athlete.bib,
        eventId: athlete.eventId ?? searchEvent?.id ?? '',
        participantUuid: athlete.participantUuid,
        providerUuid: athlete.providerUuid,
        providerTimingUuid: athlete.providerTimingUuid,
        providerRecordId: athlete.providerRecordId,
        athleteUid: athlete.athleteUid,
        bookingId: athlete.bookingId,
      },
    });

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: theme.colors.background }}
      edges={['top', 'left', 'right']}>
      <ScrollView
        contentContainerStyle={{
          padding: theme.spacing.base,
          gap: theme.spacing.md,
          maxWidth: isTablet ? theme.maxContentWidth : undefined,
          alignSelf: 'center',
          width: '100%',
          flexGrow: 1,
        }}
        showsVerticalScrollIndicator={false}>
        <View style={{ gap: 2, paddingBottom: theme.spacing.sm }}>
          <Text variant="display">Track Athletes</Text>
          <Text variant="body" color="textMuted">
            {ids.length} athlete{ids.length === 1 ? '' : 's'} followed
          </Text>
        </View>

        <Card style={{ gap: theme.spacing.md }}>
          <Text variant="label" color="textMuted">
            SEARCH ATHLETE
          </Text>
          <SearchBar
            value={search}
            onChangeText={setSearch}
            placeholder="Name, bib, club, or country"
          />
          {debounced.trim().length > 0 ? (
            <View style={{ gap: theme.spacing.sm }}>
              {athleteSearch.isFetching ? (
                <View style={{ gap: theme.spacing.sm }}>
                  <Skeleton height={76} radius={theme.radius.large} />
                  <Text variant="bodySmall" color="textMuted">
                    Syncing live data...
                  </Text>
                </View>
              ) : (athleteSearch.data ?? []).length > 0 ? (
                (athleteSearch.data ?? []).map((athlete) => (
                  <Card
                    key={athlete.id}
                    onPress={() => {
                      addAthlete({
                        id: athlete.id,
                        bib: athlete.bib,
                        name: athlete.name,
                        eventId: searchEvent?.id,
                        category: athlete.category,
                        club: athlete.club,
                        photoUrl: athlete.photoUrl,
                        participantUuid: athlete.participantUuid,
                        providerUuid: athlete.providerUuid,
                        providerTimingUuid: athlete.providerTimingUuid,
                        providerRecordId: athlete.providerRecordId,
                        athleteUid: athlete.athleteUid,
                        bookingId: athlete.bookingId,
                      });
                    }}
                    style={{
                      borderColor: isWatched(athlete.id)
                        ? theme.colors.accent
                        : theme.colors.border,
                    }}>
                    <View
                      style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
                      <Avatar name={athlete.name} uri={athlete.photoUrl} colorSeed={athlete.id} />
                      <View style={{ flex: 1, gap: 2 }}>
                        <Text variant="headline" numberOfLines={1}>
                          {athlete.name}
                        </Text>
                        <Text variant="bodySmall" color="textMuted" numberOfLines={2}>
                          Bib {athlete.bib}
                          {athlete.club ? ` · ${athlete.club}` : ''}
                          {athlete.category ? ` · ${athlete.category}` : ''}
                        </Text>
                      </View>
                      <Text variant="label" color={isWatched(athlete.id) ? 'accent' : 'textMuted'}>
                        {isWatched(athlete.id) ? 'ADDED' : 'ADD'}
                      </Text>
                    </View>
                  </Card>
                ))
              ) : (
                <Text variant="bodySmall" color="textMuted">
                  No athletes found for “{debounced}”.
                </Text>
              )}
            </View>
          ) : (
            <Text variant="bodySmall" color="textMuted">
              Search the current event start list; tap a result to add it to Tracking.
            </Text>
          )}
        </Card>

        {ids.length === 0 ? (
          <EmptyState
            title="Your watchlist is empty"
            description="Follow athletes from a live event to track their progress and get alerts."
            icon={<Icon name="heart" size={40} color="textMuted" />}
            actionLabel="Explore events"
            onAction={() => router.push('/events')}
          />
        ) : (
          <Card padded={false} style={{ overflow: 'hidden' }}>
            {athletes.map((athlete) => (
              <ListItem
                key={athlete.id}
                title={athlete.name}
                subtitle={`Bib ${athlete.bib}${athlete.club ? ` · ${athlete.club}` : ''}${athlete.category ? ` · ${athlete.category}` : ''}`}
                trailing={<Icon name="heartFilled" color="accent" />}
                onPress={() => openAthlete(athlete)}
              />
            ))}
          </Card>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
