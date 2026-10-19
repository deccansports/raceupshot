import { useEffect, useId, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { CanonicalChangeEvent } from '@raceupshot/live-tracking-contracts';

import { queryKeys } from '@/core/services/query/queryKeys';
import { subscribeCanonicalChangeStream } from './canonicalChangeStreamRegistry';

const pendingRenders = new Map<string, CanonicalChangeEvent>();

export function participantQuery(queryKey: readonly unknown[], eventId: string, participantUuid?: string): boolean {
  if (queryKey[0] === 'tracking' && queryKey[1] === 'participants' && queryKey[2] === eventId) return true;
  if (!participantUuid) return queryKey[0] === 'tracking' && queryKey[2] === eventId;
  if (queryKey[0] === 'tracking' && queryKey[1] === 'athlete-detail' && queryKey[2] === eventId) {
    // A persisted watchlist can be keyed by bib or an older provider UUID,
    // while the change hub always publishes the canonical participant UUID.
    // Refresh the event's active athlete reads instead of dropping the update
    // when those equivalent identities are spelled differently.
    return true;
  }
  // Canonical query keys can also retain a bib/provider alias, so apply the
  // same event-scoped refresh rule to athlete snapshots from that repository.
  return queryKey[0] === 'canonical-live' && queryKey[1] === eventId && queryKey[3] === 'athlete';
}

function leaderboardQuery(queryKey: readonly unknown[], eventId: string): boolean {
  return (queryKey[0] === 'tracking' && queryKey[1] === 'leaderboard' && queryKey[2] === eventId)
    || (queryKey[0] === 'canonical-live-rankings' && queryKey[1] === eventId)
    || (queryKey[0] === 'canonical-live' && queryKey[1] === eventId && queryKey[3] === 'leaderboard');
}

export function markCanonicalParticipantRendered(eventId: string, participantUuid: string | undefined) {
  if (!participantUuid) return;
  const pending = pendingRenders.get(`${eventId}:${participantUuid}`);
  if (!pending) return;
  pendingRenders.delete(`${eventId}:${participantUuid}`);
  const renderedAt = new Date().toISOString();
  console.info('[canonical-change:mobile:rendered]', {
    eventId, participantUuid, manifestVersion: pending.manifestVersion, canonicalUpdateRenderedAt: renderedAt,
    accepted_to_client_update_ms: pending.feibotReadAcceptedAt ? Date.parse(renderedAt) - Date.parse(pending.feibotReadAcceptedAt) : null,
  });
}

export function useCanonicalChangeStream(eventId: string, enabled = true): {
  health: 'disabled' | 'degraded' | 'healthy';
  isHealthy: boolean;
} {
  const queryClient = useQueryClient();
  const [health, setHealth] = useState<'disabled' | 'degraded' | 'healthy'>(
    enabled ? 'degraded' : 'disabled',
  );
  const consumerId = useId();
  useEffect(() => {
    if (!enabled || !eventId) return;

    const matchesEvent = (queryKey: readonly unknown[]) =>
      (queryKey[0] === 'canonical-live' && queryKey[1] === eventId)
      || (queryKey[0] === 'tracking' && queryKey[2] === eventId)
      || (queryKey[0] === 'canonical-live-rankings' && queryKey[1] === eventId);
    const reconcile = async () => {
      await queryClient.invalidateQueries({ predicate: ({ queryKey }) => matchesEvent(queryKey) });
      await queryClient.refetchQueries({ predicate: ({ queryKey }) => matchesEvent(queryKey), type: 'active' });
    };
    const apply = async (change: CanonicalChangeEvent) => {
      if (change.participantUuid) pendingRenders.set(`${eventId}:${change.participantUuid}`, change);
      const receivedAt = new Date().toISOString();
      console.info('[canonical-change:mobile]', {
        eventId, participantUuid: change.participantUuid ?? null, manifestVersion: change.manifestVersion,
        canonicalUpdateReceivedAt: receivedAt,
        canonical_to_client_ms: Date.parse(receivedAt) - Date.parse(change.canonicalWriteCompletedAt),
      });
      const participantPredicate = ({ queryKey }: { queryKey: readonly unknown[] }) => participantQuery(queryKey, eventId, change.participantUuid);
      const leaderboardPredicate = ({ queryKey }: { queryKey: readonly unknown[] }) => leaderboardQuery(queryKey, eventId);
      await Promise.all([
        queryClient.cancelQueries({ predicate: participantPredicate }),
        queryClient.cancelQueries({ predicate: leaderboardPredicate }),
      ]);
      await Promise.all([
        queryClient.invalidateQueries({ predicate: participantPredicate }),
        queryClient.invalidateQueries({ predicate: leaderboardPredicate }),
        queryClient.invalidateQueries({ queryKey: queryKeys.canonical.availability(eventId) }),
      ]);
      await Promise.all([
        queryClient.refetchQueries({ predicate: participantPredicate, type: 'active' }),
        queryClient.refetchQueries({ predicate: leaderboardPredicate, type: 'active' }),
      ]);
      const completedAt = new Date().toISOString();
      console.info('[canonical-change:mobile:refetched]', {
        eventId, participantUuid: change.participantUuid ?? null, manifestVersion: change.manifestVersion,
        push_to_refetch_ms: Date.parse(completedAt) - Date.parse(change.publishedAt),
        accepted_to_client_update_ms: change.feibotReadAcceptedAt ? Date.parse(completedAt) - Date.parse(change.feibotReadAcceptedAt) : null,
      });
    };
    const lease = subscribeCanonicalChangeStream({
      eventId,
      consumerId: `canonical-change-consumer-${consumerId}`,
      onChange: (change) => { void apply(change); },
      onHealth: setHealth,
      onRecovery: () => { void reconcile(); },
    });
    return () => lease.release();
  }, [consumerId, enabled, eventId, queryClient]);
  const resolvedHealth = enabled && eventId ? health : 'disabled';
  return { health: resolvedHealth, isHealthy: resolvedHealth === 'healthy' };
}
