import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import {
  CanonicalTrackingRepository,
  resolveCanonicalAvailability,
  type CanonicalAthleteLookup,
} from '@/core/repositories/canonicalTracking.repository';
import { queryKeys } from '@/core/services/query/queryKeys';

const activeVersions = new Map<string, string>();
const PARTICIPANT_RECOVERY_INTERVAL_MS = 30_000;
const ATHLETE_RECOVERY_INTERVAL_MS = 10_000;

export function useCanonicalAvailability(eventId: string, enabled = true) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: queryKeys.canonical.availability(eventId),
    queryFn: ({ signal }) => resolveCanonicalAvailability(eventId, signal),
    enabled: enabled && Boolean(eventId),
    staleTime: 60_000,
    retry: false,
  });

  useEffect(() => {
    if (!eventId || !query.data) return;
    if (!query.data.ready) {
      if (query.data.reason === 'visibility_disabled') {
        queryClient.removeQueries({
          predicate: ({ queryKey }) => queryKey[0] === 'canonical-live' && queryKey[1] === eventId && queryKey[2] !== 'availability',
        });
        queryClient.removeQueries({ queryKey: queryKeys.participants(eventId) });
        queryClient.removeQueries({ queryKey: ['tracking', 'athlete-detail', eventId] });
        activeVersions.delete(eventId);
      }
      return;
    }
    const previous = activeVersions.get(eventId);
    if (previous && previous !== query.data.activeVersion) {
      queryClient.removeQueries({
        predicate: ({ queryKey }) => queryKey[0] === 'canonical-live' && queryKey[1] === eventId && queryKey[2] === previous,
      });
    }
    activeVersions.set(eventId, query.data.activeVersion);
    queryClient.setQueryData(queryKeys.canonical.course(eventId, query.data.activeVersion), query.data.course);
  }, [eventId, query.data, queryClient]);

  return query;
}

export function useCanonicalParticipants(eventId: string, activeVersion: string | undefined, enabled: boolean, polling: boolean) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: queryKeys.canonical.participants(eventId, activeVersion ?? 'pending'),
    queryFn: async ({ signal }) => {
      const result = await CanonicalTrackingRepository.getCanonicalParticipants(eventId, signal);
      if (result.activeVersion !== activeVersion) {
        queryClient.removeQueries({
          predicate: ({ queryKey }) => queryKey[0] === 'canonical-live' && queryKey[1] === eventId && queryKey[2] === activeVersion,
        });
        await queryClient.invalidateQueries({ queryKey: queryKeys.canonical.availability(eventId) });
        throw new Error('CANONICAL_ACTIVE_VERSION_CHANGED');
      }
      return result.data;
    },
    enabled: enabled && Boolean(eventId) && Boolean(activeVersion),
    staleTime: 750,
    // Stream invalidations are the fast path. This large event-wide artifact
    // is only polled as a bounded recovery path.
    refetchInterval: polling ? PARTICIPANT_RECOVERY_INTERVAL_MS : false,
    refetchIntervalInBackground: false,
    placeholderData: (previous) => previous,
    retry: false,
  });
}

function lookupIdentity(lookup: CanonicalAthleteLookup): string {
  const [key, value] = Object.entries(lookup)[0];
  return `${key}:${value}`;
}

export function useCanonicalAthlete(eventId: string, activeVersion: string | undefined, lookup: CanonicalAthleteLookup | undefined, enabled: boolean, polling: boolean) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: queryKeys.canonical.athlete(eventId, activeVersion ?? 'pending', lookup ? lookupIdentity(lookup) : 'missing'),
    queryFn: async ({ signal }) => {
      if (!lookup) throw new Error('CANONICAL_ATHLETE_LOOKUP_REQUIRED');
      const result = await CanonicalTrackingRepository.getCanonicalAthlete(eventId, lookup, signal);
      if (result.activeVersion !== activeVersion) {
        queryClient.removeQueries({
          predicate: ({ queryKey }) => queryKey[0] === 'canonical-live' && queryKey[1] === eventId && queryKey[2] === activeVersion,
        });
        await queryClient.invalidateQueries({ queryKey: queryKeys.canonical.availability(eventId) });
        throw new Error('CANONICAL_ACTIVE_VERSION_CHANGED');
      }
      return result.data;
    },
    enabled: enabled && Boolean(eventId) && Boolean(activeVersion) && Boolean(lookup),
    staleTime: 750,
    refetchInterval: polling ? ATHLETE_RECOVERY_INTERVAL_MS : false,
    refetchIntervalInBackground: false,
    placeholderData: (previous) => previous,
    retry: false,
  });
}
