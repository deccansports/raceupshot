import { useFocusEffect, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useTheme, type SemanticColors } from '@/core/theme';
import { useAthleteSearch } from '@/features/tracking';
import {
  AthleteCard,
  EmptyState,
  ErrorState,
  Icon,
  SearchBar,
  SectionHeader,
  Skeleton,
  Text,
  type IconName,
} from '@/shared/components';
import { useDebouncedValue } from '@/shared/hooks';

import { useEvent } from '../hooks/useEvents';
import { useEventTracking } from '../hooks/useEventExperience';
import { safeRouteEventId } from '../utils/eventRoute';

/** Large rounded action card for the secondary event navigation. */
function ActionCard({
  icon,
  label,
  onPress,
  disabled,
  tone = 'surface',
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  tone?: keyof SemanticColors;
}) {
  const theme = useTheme();
  const accented = tone === 'accent';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
      style={{
        flexGrow: 1,
        flexBasis: '46%',
        minWidth: 150,
        opacity: disabled ? 0.45 : 1,
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.sm,
        padding: theme.spacing.base,
        borderRadius: theme.radius.large,
        borderWidth: accented ? 0 : 1,
        borderColor: theme.colors.border,
        backgroundColor: accented ? theme.colors.accent : theme.colors.surface,
        ...theme.shadows.card,
      }}>
      <Icon name={icon} colorValue={accented ? theme.colors.onAccent : theme.colors.accent} />
      <Text
        variant="label"
        style={{ color: accented ? theme.colors.onAccent : theme.colors.textPrimary }}>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * Event Detail — clean live-tracking entry point. Search is the primary action
 * (tap a result → Athlete Detail); secondary screens sit in bottom action cards.
 */
export function EventDetailScreen() {
	const theme = useTheme();
	const router = useRouter();
	const { eventId } = useLocalSearchParams<{ eventId: string | string[] }>();
	const id = safeRouteEventId(eventId) ?? '';

	const handleBackPress = () => {
    router.replace(id ? `/event/${id}` : '/');
  };

  const { event, isLoading, refetch } = useEvent(id);
  const dataSource = event?.status === 'finished' ? 'results' : 'live';
  const [focused, setFocused] = useState(true);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );
  const trackingQuery = useEventTracking(id, focused && dataSource === 'live', false);
  const trackingState = String((trackingQuery.data as Record<string, unknown> | undefined)?.state ?? 'visibility-disabled');
  const liveAthleteDataReady =
    dataSource === 'results' ||
    ((trackingQuery.data as Record<string, unknown> | undefined)?.publicAthleteVisibility === true && trackingState === 'ready');

  const [athleteQuery, setAthleteQuery] = useState('');
  const debouncedQuery = useDebouncedValue(athleteQuery, 200);
  const searchMode = /^\d+$/.test(debouncedQuery.trim()) ? 'bib' : 'name';
  const athleteSearch = useAthleteSearch(id, debouncedQuery, searchMode, focused && liveAthleteDataReady, dataSource);

  const openAthlete = (bib: string, athleteUid?: string) => {
    const query = athleteUid
      ? `?eventId=${encodeURIComponent(id)}&athleteUid=${encodeURIComponent(athleteUid)}`
      : `?eventId=${encodeURIComponent(id)}`;
    router.push(`/athletes/${encodeURIComponent(bib)}${query}` as Href);
  };
  const openLeaderboard = () =>
    id ? router.push({ pathname: '/event/[eventId]/leaderboard', params: { eventId: id } }) : undefined;
  const openResults = () =>
    id ? router.push({ pathname: '/event/[eventId]/results', params: { eventId: id } }) : undefined;
  const openCourse = () => id && router.push({ pathname: '/course/[eventId]', params: { eventId: id } });
  const openSettings = () => router.push('/settings');

  const back = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Go back"
      onPress={handleBackPress}
      hitSlop={8}
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
  );

  if (isLoading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <View style={{ padding: theme.spacing.base, gap: theme.spacing.md }}>
          <Skeleton height={200} radius={theme.radius.xl} />
          <Skeleton height={56} radius={theme.radius.large} />
        </View>
      </SafeAreaView>
    );
  }

  if (!event) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <View style={{ padding: theme.spacing.base }}>{back}</View>
        <ErrorState
          title="Event unavailable"
          description="We couldn't load this event."
          onRetry={() => refetch()}
        />
      </SafeAreaView>
    );
  }

  const results = athleteSearch.data ?? [];
  const searching = debouncedQuery.trim().length > 0;

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          padding: theme.spacing.base,
          paddingBottom: 40,
          gap: theme.spacing.xl,
        }}
        showsVerticalScrollIndicator={false}>
        <SafeAreaView edges={['top']} style={{ gap: theme.spacing.md }}>
          {back}
          <View style={{ gap: theme.spacing.xs }}>
            <Text variant="display">{event.name}</Text>
            {event.dateLabel ? (
              <Text variant="bodySmall" color="textMuted">
                {event.dateLabel}
              </Text>
            ) : null}
          </View>
        </SafeAreaView>

        <View style={{ gap: theme.spacing.sm }}>
          <SectionHeader title="Search Athlete for Tracking" />
          <SearchBar
            value={athleteQuery}
            onChangeText={setAthleteQuery}
            placeholder="Search athlete name or bib"
          />
          {searching ? (
            <View style={{ gap: theme.spacing.md, marginTop: theme.spacing.xs }}>
              {athleteSearch.isFetching ? (
                <View style={{ gap: theme.spacing.sm }}>
                  <Skeleton height={72} radius={theme.radius.large} />
                  <Text variant="bodySmall" color="textMuted">
                    Syncing live data...
                  </Text>
                </View>
              ) : results.length > 0 ? (
                results.map((a) => (
                  <AthleteCard
                    key={a.id}
                    name={a.name}
                    subtitle={`${a.category ?? ''} · Bib ${a.bib}`}
                    avatarUri={a.photoUrl}
                    avatarSeed={a.id}
                    status={a.status}
        onPress={() => openAthlete(a.bib, a.athleteUid)}
                  />
                ))
              ) : (
                <EmptyState
                  title="No athletes found"
                  description={`No athletes match “${debouncedQuery}”.`}
                />
              )}
            </View>
          ) : (
            <Text variant="bodySmall" color="textMuted">
              Search a name or bib to open live tracking for that athlete.
            </Text>
          )}
        </View>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
          <ActionCard icon="trophy" label="Leaderboards" tone="accent" onPress={openLeaderboard} />
          <ActionCard icon="medal" label="Official Results" onPress={openResults} />
          <ActionCard icon="map" label="Course Maps" onPress={openCourse} />
          <ActionCard icon="filter" label="Settings" onPress={openSettings} />
        </View>
      </ScrollView>
    </View>
  );
}
