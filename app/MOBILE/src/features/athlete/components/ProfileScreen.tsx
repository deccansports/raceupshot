import { ScrollView, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { repositories } from '@/core/repositories';
import { queryKeys } from '@/core/services/query/queryKeys';
import { usePreferencesStore, type ColorSchemePreference } from '@/core/store';
import { useTheme } from '@/core/theme';
import { useAuth } from '@/features/auth';
import { Avatar, Button, Card, ErrorState, ListItem, Skeleton, TabBar, Text } from '@/shared/components';
import { useResponsive } from '@/shared/hooks';

const wordmark = require('../../../../assets/images/bm.png');

export function ProfileScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { isTablet } = useResponsive();
  const scheme = usePreferencesStore((s) => s.colorScheme);
  const setColorScheme = usePreferencesStore((s) => s.setColorScheme);
  const { status, user, logout } = useAuth();
  const [updatingVisibility, setUpdatingVisibility] = useState(false);

  const isAuthenticated = status === 'authenticated';
  const isReady = isAuthenticated && Boolean(user);
  const profile = useQuery({
    queryKey: user?.uid ? queryKeys.profile(user.uid) : ['profile', 'me'],
    queryFn: () => repositories.profile.getProfile(),
    enabled: isReady,
    staleTime: 5 * 60 * 1000,
  });
  const athlete = profile.data;
  const registration = athlete?.registrations?.[0];
  const liveTrackingVisibility = registration?.liveTrackingVisibility ?? registration?.visibility;
  const clubName = (
    (athlete as { currentClub?: { name?: string | null; clubName?: string | null; displayName?: string | null } | null })?.currentClub?.name ??
    (athlete as { currentClub?: { name?: string | null; clubName?: string | null; displayName?: string | null } | null })?.currentClub?.clubName ??
    (athlete as { currentClub?: { name?: string | null; clubName?: string | null; displayName?: string | null } | null })?.currentClub?.displayName ??
    (athlete as { currentAffiliation?: { name?: string | null; clubName?: string | null; displayName?: string | null } | null })?.currentAffiliation?.name ??
    (athlete as { currentAffiliation?: { name?: string | null; clubName?: string | null; displayName?: string | null } | null })?.currentAffiliation?.clubName ??
    (athlete as { currentAffiliation?: { name?: string | null; clubName?: string | null; displayName?: string | null } | null })?.currentAffiliation?.displayName ??
    (athlete as { activeClub?: { name?: string | null; clubName?: string | null; displayName?: string | null } | null })?.activeClub?.name ??
    (athlete as { activeClub?: { name?: string | null; clubName?: string | null; displayName?: string | null } | null })?.activeClub?.clubName ??
    (athlete as { activeClub?: { name?: string | null; clubName?: string | null; displayName?: string | null } | null })?.activeClub?.displayName ??
    (typeof athlete?.club === 'object' ? (athlete.club as { name?: string | null })?.name : undefined)
  ) || 'No club';

  const toggleVisibility = async () => {
    if (!registration?.eventId) return;
    const nextVisibility = liveTrackingVisibility === 'ANONYMOUS' ? 'PUBLIC' : 'ANONYMOUS';
    setUpdatingVisibility(true);
    try {
      await repositories.profile.updateEventPrivacy(registration.eventId, nextVisibility);
      await profile.refetch();
    } finally {
      setUpdatingVisibility(false);
    }
  };

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: theme.colors.background }}
      edges={['top', 'left', 'right']}>
      <ScrollView
        contentContainerStyle={{
          padding: theme.spacing.base,
          gap: theme.spacing.lg,
          maxWidth: isTablet ? theme.maxContentWidth : undefined,
          alignSelf: 'center',
          width: '100%',
        }}
        showsVerticalScrollIndicator={false}>
        {/* Header: authenticated vs guest */}
        <Card
          style={{
            alignItems: 'center',
            gap: theme.spacing.md,
            paddingVertical: theme.spacing.xl,
          }}>
          {isAuthenticated && user ? (
            <>
              <Avatar
                name={athlete?.name ?? user.displayName ?? user.email ?? 'Athlete'}
                uri={athlete?.profilePhotoUrl ?? undefined}
                size={72}
              />
              <View style={{ alignItems: 'center', gap: 2 }}>
                <Text variant="title">{athlete?.name ?? 'Welcome back'}</Text>
                <Text variant="body" color="textMuted">
                  {athlete?.email ?? user.email ?? user.displayName ?? 'Athlete'}
                </Text>
              </View>
              <Button
                label="Log out"
                variant="ghost"
                fullWidth
                onPress={() => {
                  void logout().finally(() => router.replace('/auth/login'));
                }}
              />
            </>
          ) : (
            <>
              <Image source={wordmark} style={{ width: 220, height: 54 }} contentFit="contain" />
              <View style={{ alignItems: 'center', gap: 2 }}>
                <Text variant="title">Settings</Text>
                <Text variant="body" color="textMuted">
                  Account and app preferences
                </Text>
              </View>
            </>
          )}
        </Card>

        {isAuthenticated ? (
          profile.isLoading ? (
            <View style={{ gap: theme.spacing.md }}>
              <Skeleton height={96} radius={theme.radius.large} />
              <Skeleton height={140} radius={theme.radius.large} />
            </View>
          ) : profile.isError ? (
            <ErrorState
              description={profile.error instanceof Error ? profile.error.message : "We couldn't load your BERGMAN profile."}
              onRetry={() => profile.refetch()}
            />
          ) : athlete ? (
            <>
              <Card style={{ gap: theme.spacing.sm }}>
                <Text variant="label" color="textMuted">
                  BEL
                </Text>
                <Text variant="headline">
                  Overall #{athlete.rankings?.overall ?? '—'} · Category #
                  {athlete.rankings?.category ?? '—'}
                </Text>
                <Text variant="bodySmall" color="textMuted">
                  {clubName} · {athlete.statistics?.points ?? 0} points
                </Text>
              </Card>

              <Card style={{ gap: theme.spacing.sm }}>
                <Text variant="label" color="textMuted">
                  MY EVENTS
                </Text>
                {(athlete.registrations ?? []).length === 0 ? (
                  <Text variant="body" color="textMuted">
                    No registered events returned by the backend.
                  </Text>
                ) : (
                  (athlete.registrations ?? []).map((registration) => (
                    <ListItem
                      key={`${registration.eventId}-${registration.bib ?? registration.athleteId}`}
                      title={registration.eventName ?? registration.eventId}
                      subtitle={[
                        registration.dateLabel,
                        registration.bib ? `Bib ${registration.bib}` : undefined,
                        registration.category,
                        registration.status,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    />
                  ))
                )}
              </Card>

              <Card style={{ gap: theme.spacing.sm }}>
                <Text variant="label" color="textMuted">
                  LIVE TRACKING PUBLIC STATUS
                </Text>
                <Text variant="headline">
                  {liveTrackingVisibility === 'ANONYMOUS' ? 'Anonymous' : 'Public'}
                </Text>
                {registration?.eventId ? (
                  <Button
                    label={liveTrackingVisibility === 'ANONYMOUS' ? 'Make Public' : 'Make Anonymous'}
                    variant="secondary"
                    onPress={() => void toggleVisibility()}
                    disabled={updatingVisibility}
                  />
                ) : null}
              </Card>
            </>
          ) : null
        ) : null}

        {/* Appearance */}
        <View style={{ gap: theme.spacing.sm }}>
          <Text variant="label" color="textMuted">
            APPEARANCE
          </Text>
          <TabBar
            items={[
              { key: 'light', label: 'Light' },
              { key: 'dark', label: 'Dark' },
              { key: 'system', label: 'System' },
            ]}
            activeKey={scheme}
            onChange={(k) => setColorScheme(k as ColorSchemePreference)}
          />
        </View>
        <Text variant="caption" color="textMuted" center>
          BERGMAN Race · v1.0.0
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}
