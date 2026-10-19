import { queryClient } from './queryClient';
import { queryKeys } from './queryKeys';

/**
 * Centralized React Query invalidation helpers. Use these instead of inlining
 * invalidateQueries calls so cache invalidation stays consistent.
 */
export const queryInvalidation = {
  events: () => queryClient.invalidateQueries({ queryKey: queryKeys.events.list }),
  eventTracking: (eventId: string) =>
    queryClient.invalidateQueries({ queryKey: queryKeys.events.tracking(eventId) }),
  leaderboard: (eventId: string) =>
    queryClient.invalidateQueries({ queryKey: ['tracking', 'leaderboard', eventId] }),
  athleteSearch: (eventId: string) =>
    queryClient.invalidateQueries({ queryKey: ['tracking', 'athlete-search', eventId] }),
  athleteDetail: (eventId: string) =>
    queryClient.invalidateQueries({ queryKey: ['tracking', 'athlete-detail', eventId] }),
  courseMap: (eventId: string) =>
    queryClient.invalidateQueries({ queryKey: queryKeys.courseMap(eventId) }),
  profile: (uid: string) => queryClient.invalidateQueries({ queryKey: queryKeys.profile(uid) }),
  /** Invalidate every live-tracking query for an event (leaderboard/search/detail/course). */
  tracking: (eventId: string) => {
    void queryInvalidation.leaderboard(eventId);
    void queryInvalidation.athleteSearch(eventId);
    void queryInvalidation.athleteDetail(eventId);
    void queryInvalidation.courseMap(eventId);
  },
  clearAll: () => queryClient.clear(),
};
