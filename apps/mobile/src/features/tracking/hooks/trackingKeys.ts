export { queryKeys } from '@/core/services/query/queryKeys';

/** Poll/cache intervals mirroring the web app (see docs/WEB_APP_ANALYSIS §4). */
export const TRACKING_INTERVALS = {
  trackingRefetchMs: 12000,
  leaderboardRefetchMs: 5000,
  athleteDetailRefetchMs: 1000,
  replayRefetchMs: 45000,
  staleMs: 4000,
  eventsStaleMs: 30 * 60 * 1000,
  courseStaleMs: 60 * 60 * 1000,
} as const;
