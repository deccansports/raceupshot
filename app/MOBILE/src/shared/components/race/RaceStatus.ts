import type { SemanticColors } from '@/core/theme';
import type { RaceStatus } from '@/core/types';

export type { RaceStatus };

type RaceStatusMeta = {
  label: string;
  color: keyof SemanticColors;
};

/**
 * BERGMAN race status system:
 *   LIVE (red) · FINISHED (green) · UPCOMING (amber) · NOT STARTED (grey)
 */
export const raceStatusMeta: Record<RaceStatus, RaceStatusMeta> = {
  live: { label: 'Live', color: 'statusLive' },
  finished: { label: 'Finished', color: 'statusFinished' },
  upcoming: { label: 'Upcoming', color: 'statusUpcoming' },
  notStarted: { label: 'Not Started', color: 'statusNotStarted' },
};
