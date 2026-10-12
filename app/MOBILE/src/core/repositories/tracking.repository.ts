import { liveApi } from '@/core/services/api';
import type { ProviderStatus, ReplayIndex, ResolvedTimingConfiguration } from '@/core/types';

/** Tracking repository — existing BERGMAN REST APIs. */
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
  getOverview: (eventId, signal) => liveApi.json(`/api/events/${eventId}/tracking`, { signal }),
  getParticipants: (eventId, signal) => liveApi.json(`/api/events/${eventId}/tracking`, { signal }),
  getAthletes: (eventId, categoryId, signal) =>
    liveApi.json(`/api/events/${eventId}/tracking`, { params: { categoryId }, signal }),
  getWorkerLeaderboard: (eventId, mode = 'overall', limit = 25, signal) =>
    liveApi.json(`/api/live/events/${eventId}/leaderboard`, { params: { mode, limit }, signal }),
  async getTimings(eventId, signal) {
    const res = await liveApi.json<{ success?: boolean; timingConfiguration?: ResolvedTimingConfiguration | null }>(`/api/live/course-index/${eventId}`, {
      signal,
    });
    return {
      success: typeof res?.success === 'boolean' ? res.success : true,
      eventId,
      timings: res.timingConfiguration ?? null,
    };
  },
  getBroadcast: (eventId, signal) => liveApi.json(`/api/live/events/${eventId}/broadcast`, { signal }),
  async getReplay(eventId, signal) {
    const res = await liveApi.json<{
      success?: boolean;
      data?: { replay?: { eventId?: string; videos?: unknown[]; lastSyncAt?: string | null } };
    }>(`/api/live/replay/${eventId}`, { signal });
    const replay = res.data?.replay;
    return {
      eventId,
      available: Boolean((replay?.videos ?? []).length),
      frames: replay?.videos?.length ?? 0,
      generatedAt: replay?.lastSyncAt ?? null,
    };
  },
  getProviderConfig: (eventId, signal) => liveApi.json(`/api/live/course-config`, { params: { eventId }, signal }),
  getMonitoring: (eventId, signal) => liveApi.json(`/api/live/course-config`, { params: { eventId }, signal }),
};
