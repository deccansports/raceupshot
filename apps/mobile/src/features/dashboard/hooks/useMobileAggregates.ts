import { useInfiniteQuery, useQuery } from '@tanstack/react-query';

import {
  repositories,
  type AthleteProfile,
  type ClubRankingEntry,
  type AthleteRankingEntry,
  type RankingFilters,
} from '@/core/repositories';
import { queryKeys } from '@/core/services/query/queryKeys';

const DASHBOARD_STALE_MS = 60 * 1000;
const DASHBOARD_GC_MS = 10 * 60 * 1000;
const STALE_MS = 5 * 60 * 1000;
const PAGE_SIZE = 25;

export function useAthleteDashboard(enabled = true) {
  return useQuery({
    queryKey: queryKeys.athleteDashboard(),
    queryFn: () => repositories.mobile.getAthleteDashboard(),
    staleTime: DASHBOARD_STALE_MS,
    gcTime: DASHBOARD_GC_MS,
    retry: false,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    placeholderData: (previous) => previous,
    enabled,
  });
}

export function useAthleteProfile(athleteId: string) {
  return useQuery({
    queryKey: queryKeys.dashboard.athleteProfile(athleteId),
    queryFn: () => repositories.mobile.getAthleteProfile(athleteId),
    staleTime: STALE_MS,
    retry: false,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    enabled: Boolean(athleteId),
  });
}

export function useMobileProfile(enabled = true, uid?: string) {
  return useQuery<AthleteProfile>({
    queryKey: uid ? queryKeys.profile(uid) : queryKeys.athleteProfile(),
    queryFn: () => repositories.profile.getProfile(),
    staleTime: STALE_MS,
    retry: false,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    enabled,
  });
}

export function useTrainingDashboard() {
  return useQuery({
    queryKey: queryKeys.training,
    queryFn: () => repositories.mobile.getTraining(),
    staleTime: STALE_MS,
  });
}

export function useAthleteRankings(filters: RankingFilters) {
  return useInfiniteQuery({
    queryKey: queryKeys.rankings.athletes(filters),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      repositories.mobile.getAthleteRankings({ ...filters, cursor: pageParam, limit: PAGE_SIZE }),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    staleTime: STALE_MS,
    select: (data) => data.pages.flatMap((page) => page.items) as AthleteRankingEntry[],
  });
}

export function useClubRankings(filters: RankingFilters) {
  return useInfiniteQuery({
    queryKey: queryKeys.rankings.clubs(filters),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      repositories.mobile.getClubRankings({ ...filters, cursor: pageParam, limit: PAGE_SIZE }),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    staleTime: STALE_MS,
    select: (data) => data.pages.flatMap((page) => page.items) as ClubRankingEntry[],
  });
}
