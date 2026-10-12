import { useLocalSearchParams } from 'expo-router';
import { RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useTheme } from '@/core/theme';
import { EmptyState, ErrorState, SectionHeader, Text } from '@/shared/components';

import {
  CertificateList,
  HeaderCard,
  LoadingStack,
  MetricGrid,
  RegistrationList,
  ResultList,
} from './DashboardPrimitives';
import { useAthleteProfile } from '../hooks/useMobileAggregates';

function metric(label: string, value: unknown) {
  return { label, value: value as string | number | null };
}

export function AthleteProfileScreen() {
  const theme = useTheme();
  const { athleteId } = useLocalSearchParams<{ athleteId: string }>();
  const id = athleteId ?? '';
  const query = useAthleteProfile(id);
  const profile = query.data;
  const athlete = profile?.profile ?? profile?.athlete;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }} edges={['top']}>
      <ScrollView
        contentContainerStyle={{
          padding: theme.spacing.base,
          paddingBottom: 48,
          gap: theme.spacing.lg,
        }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={query.isRefetching}
            onRefresh={query.refetch}
            tintColor={theme.colors.accent}
          />
        }>
        <Text variant="display">Athlete Profile</Text>
        {query.isLoading ? <LoadingStack /> : null}
        {query.isError ? (
          <ErrorState
            title="Athlete profile unavailable"
            description="The BERGMAN backend did not return an athlete profile payload."
            onRetry={() => query.refetch()}
          />
        ) : null}
        {!query.isLoading && !query.isError && !athlete ? (
          <EmptyState
            title="No athlete profile"
            description="This account does not have a profile record yet."
          />
        ) : null}
        {profile && athlete ? (
          <>
            <HeaderCard
              title={athlete.name}
              subtitle={athlete.club ?? undefined}
              imageUri={athlete.photoUrl}
              badge={athlete.belTier ?? undefined}
              meta={[athlete.country, athlete.state, athlete.city].filter(Boolean) as string[]}
            />
            <View style={{ gap: theme.spacing.sm }}>
              <SectionHeader title="Statistics" />
              <MetricGrid
                metrics={[
                  metric('Total Races', profile.statistics?.totalRaces),
                  metric('Finishes', profile.statistics?.totalFinishes),
                  metric('BEL Points', profile.statistics?.totalBelPoints),
                  metric('Season Points', profile.statistics?.currentSeasonPoints),
                ]}
              />
            </View>
            <View style={{ gap: theme.spacing.sm }}>
              <SectionHeader title="Ranking" />
              <MetricGrid
                metrics={[
                  metric('Overall', profile.ranking?.overallRank),
                  metric('Gender', profile.ranking?.genderRank),
                  metric('Age Group', profile.ranking?.ageGroupRank),
                  metric('Club', profile.ranking?.clubRank),
                ]}
              />
            </View>
            <ResultList title="Recent Results" data={profile.recentResults?.slice(0, 5)} />
            <RegistrationList title="Upcoming Races" data={profile.upcomingEvents} />
            <CertificateList data={profile.certificates} />
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
