import { liveApi } from '@/core/services/api';
import type { ProviderStatus, ReplayIndex, ResolvedTimingConfiguration } from '@/core/types';

/** Tracking repository — Race Upshot's event-scoped Worker APIs. */
type WorkerEnvelope<T> = { success: boolean; eventId: string } & T;

export interface ITrackingRepository {
  getOverview(eventId: string, signal?: AbortSignal): Promise<Record<string, unknown>>;
  getParticipants(eventId: string, signal?: AbortSignal): Promise<WorkerEnvelope<{
    participants: unknown[];
    count?: number;
    source?: 'live_event_participant_index' | 'event_scoped_registration_index' | 'no_data' | 'visibility_lock' | string;
    resolvedKey?: string | null;
    recordCount?: number;
    fallbackUsed?: boolean;
    publicAthleteVisibility?: boolean;
    visibilityEnabled?: boolean;
    visibilityVersion?: number;
  }>>;
  getAthletes(
    eventId: string,
    categoryId?: string,
    signal?: AbortSignal,
  ): Promise<WorkerEnvelope<{ participants: unknown[] }>>;
  getWorkerLeaderboard(
    eventId: string,
    mode?: string,
    limit?: number,
    signal?: AbortSignal,
  ): Promise<WorkerEnvelope<{ leaderboard: { mode: string; limit: number; rows: unknown[] } }>>;
  getTimings(
    eventId: string,
    signal?: AbortSignal,
  ): Promise<WorkerEnvelope<{ timings: ResolvedTimingConfiguration | null }>>;
  getBroadcast(eventId: string, signal?: AbortSignal): Promise<Record<string, unknown>>;
  getReplay(eventId: string, signal?: AbortSignal): Promise<ReplayIndex>;
  getProviderConfig(eventId: string, signal?: AbortSignal): Promise<ProviderStatus>;
  getMonitoring(eventId: string, signal?: AbortSignal): Promise<Record<string, unknown>>;
}

export const ProductionTrackingRepository: ITrackingRepository = {
  getOverview: (eventId, signal) => liveApi.json(`/api/v1/events/${encodeURIComponent(eventId)}/live`, { signal }),
  getParticipants: (eventId, signal) => liveApi.json(`/api/v1/events/${encodeURIComponent(eventId)}/participants`, { signal }),
  getAthletes: (eventId, categoryId, signal) =>
    liveApi.json(`/api/v1/events/${encodeURIComponent(eventId)}/participants`, { params: { category: categoryId }, signal }),
  getWorkerLeaderboard: (eventId, mode = 'overall', limit = 25, signal) =>
    liveApi.json(`/api/v1/events/${encodeURIComponent(eventId)}/leaderboards`, { params: { mode, limit }, signal }),
  async getTimings(eventId, signal) {
    const res = await liveApi.json<{
      success?: boolean;
      data?: { timingConfiguration?: ResolvedTimingConfiguration | null };
    }>(`/api/v1/events/${encodeURIComponent(eventId)}/course`, { signal });
    return {
      success: typeof res?.success === 'boolean' ? res.success : true,
      eventId,
      timings: res.data?.timingConfiguration ?? null,
    };
  },
  getBroadcast: (eventId, signal) => liveApi.json(`/api/v1/events/${encodeURIComponent(eventId)}/broadcast`, { signal }),
  async getReplay(eventId, signal) {
    const res = await liveApi.json<{
      success?: boolean;
      data?: {
        replayUrl?: string | null;
        updatedAt?: string | null;
        channels?: unknown[];
      };
    }>(`/api/v1/events/${encodeURIComponent(eventId)}/broadcast`, { signal });
    const replay = res.data;
    return {
      eventId,
      available: Boolean(replay?.replayUrl),
      frames: replay?.replayUrl ? 1 : 0,
      generatedAt: replay?.updatedAt ?? null,
    };
  },
  getProviderConfig: (eventId, signal) => liveApi.json(`/api/v1/events/${encodeURIComponent(eventId)}/live`, { signal }),
  getMonitoring: (eventId, signal) => liveApi.json(`/api/v1/events/${encodeURIComponent(eventId)}/live`, { signal }),
};
