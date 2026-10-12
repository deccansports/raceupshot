import { liveApi } from '@/core/services/api';
import type { LeaderboardResponse } from '@/core/types';
import {
  CanonicalTrackingRepository,
  type CanonicalFilter,
} from './canonicalTracking.repository';

export type LeaderboardFilters = {
  contest?: string;
  ageGroup?: string;
  gender?: 'Male' | 'Female' | 'All';
  limit?: number;
};

export interface ILeaderboardRepository {
  getLeaderboard(
    eventId: string,
    filters?: LeaderboardFilters,
    signal?: AbortSignal,
  ): Promise<LeaderboardResponse>;
}

function formatElapsed(value: unknown): string {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  const whole = Math.floor(seconds);
  return [
    Math.floor(whole / 3600),
    Math.floor((whole % 3600) / 60),
    whole % 60,
  ].map((part) => String(part).padStart(2, '0')).join(':');
}

export const ProductionLeaderboardRepository: ILeaderboardRepository = {
  async getLeaderboard(eventId, filters = {}, signal) {
    type LegacyResponse = LeaderboardResponse & {
      leaderboard?: { rows?: LeaderboardResponse['athletes']; athletes?: LeaderboardResponse['athletes'] };
      rows?: LeaderboardResponse['athletes'];
    };

    // Use the same viewer-aware endpoint as the web app first. It resolves the
    // Firebase viewer and is therefore the authority for ADMIN/self exceptions
    // to an athlete's stored ANONYMOUS preference.
    try {
      const response = await liveApi.json<LegacyResponse>(`/api/live/leaderboard/${eventId}`, {
        params: {
          contest: filters.contest,
          ageGroup: filters.ageGroup,
          gender: filters.gender ?? 'All',
          limit: filters.limit ?? 100,
        },
        signal,
      });
      const athletes = Array.isArray(response.athletes)
        ? response.athletes
        : Array.isArray(response.leaderboard?.rows)
          ? response.leaderboard.rows
          : Array.isArray(response.leaderboard?.athletes)
            ? response.leaderboard.athletes
            : Array.isArray(response.rows)
              ? response.rows
              : [];
      return {
        ...response,
        athletes,
        count: Number(response.count ?? athletes.length),
        source: response.source || 'viewer_aware_live_leaderboard',
      };
    } catch (viewerAwareError) {
      if (signal?.aborted) throw viewerAwareError;
    }

    // Permanent aggregate canonical route: it does not depend on first loading
    // and interpreting the course just to discover leaderboard keys.
    try {
      const aggregate = await CanonicalTrackingRepository.getCanonicalLeaderboard(eventId, {
        contestId: filters.contest,
        ageGroup: filters.ageGroup,
        gender: filters.gender,
        limit: filters.limit ?? 100,
      }, signal);
      const athletes = aggregate.data.entries.map((entry) => {
        const visibility = String(entry.trackingVisibility ?? '').trim().toUpperCase() === 'PUBLIC'
          ? 'PUBLIC'
          : 'ANONYMOUS';
        const anonymous = visibility === 'ANONYMOUS';
        return {
          ...entry,
          athleteId: anonymous ? `anonymous:${entry.rank}:${entry.contestUuid ?? 'contest'}` : String(entry.participantUuid ?? entry.athleteId ?? ''),
          participantUuid: anonymous ? '' : String(entry.participantUuid ?? ''),
          providerParticipantUuid: anonymous ? '' : String(entry.providerParticipantUuid ?? ''),
          name: anonymous ? 'Anonymous Athlete' : String(entry.displayName ?? entry.name ?? ''),
          displayName: anonymous ? 'Anonymous Athlete' : String(entry.displayName ?? entry.name ?? ''),
          bib: anonymous ? '' : String(entry.bib ?? ''),
          bibNumber: anonymous ? '' : String(entry.bib ?? ''),
          photoUrl: anonymous ? null : entry.photoUrl,
          clubName: anonymous ? null : entry.clubName,
          countryCode: anonymous ? null : entry.countryCode,
          contest: String(entry.contestName ?? entry.contestUuid ?? ''),
          ageGroup: String(entry.ageGroupKey ?? entry.ageGroup ?? ''),
          gender: String(entry.genderKey ?? entry.gender ?? ''),
          currentLeg: String(entry.currentLeg ?? entry.legType ?? ''),
          overallTime: formatElapsed(entry.elapsedSeconds),
          overallRank: Number(entry.rank),
          gap: entry.gap ?? '—',
          trackingVisibility: visibility,
          liveTrackingVisibility: visibility,
          visibility,
        };
      }) as unknown as LeaderboardResponse['athletes'];
      return {
        success: true,
        eventId,
        athletes,
        contest: filters.contest,
        ageGroup: filters.ageGroup,
        gender: filters.gender ?? 'All',
        count: athletes.length,
        total: Number(aggregate.data.total ?? athletes.length),
        source: 'canonical',
      };
    } catch (aggregateError) {
      if (signal?.aborted) throw aggregateError;
    }

    // Backward-compatible versioned canonical fallback for older Workers.
    try {
      const course = await CanonicalTrackingRepository.getCanonicalCourse(eventId, signal);
      const contestQuery = String(filters.contest ?? '').trim().toLowerCase();
      const contests = course.data.contests.filter((contest) => {
        if (!contestQuery) return true;
        return [contest.providerContestUuid, contest.bergmanTicketId, contest.displayName, ...contest.legacyContestIds]
          .map((value) => String(value ?? '').trim().toLowerCase())
          .some((value) => value === contestQuery || value.includes(contestQuery));
      });
      const filter: CanonicalFilter = filters.gender && filters.gender !== 'All'
        ? { mode: 'gender', qualifier: filters.gender }
        : filters.ageGroup
          ? { mode: 'age', qualifier: filters.ageGroup }
          : { mode: 'overall' };
      const boards = await Promise.all(contests.map(async (contest) => {
        const contestUuid = String(contest.providerContestUuid ?? contest.bergmanTicketId ?? '').trim();
        if (!contestUuid) return [];
        try {
          const board = await CanonicalTrackingRepository.getCanonicalOverallLeaderboard(
            eventId,
            contestUuid,
            filter,
            signal,
          );
          return board.data.entries.map((entry) => ({ entry, contest }));
        } catch {
          // Some builds publish only the overall artifact. Client-side filters
          // below still produce the requested view without failing the screen.
          if (filter.mode === 'overall') throw new Error('CANONICAL_LEADERBOARD_UNAVAILABLE');
          const board = await CanonicalTrackingRepository.getCanonicalOverallLeaderboard(
            eventId,
            contestUuid,
            { mode: 'overall' },
            signal,
          );
          return board.data.entries.map((entry) => ({ entry, contest }));
        }
      }));
      const ageQuery = String(filters.ageGroup ?? '').trim().toLowerCase();
      const genderQuery = String(filters.gender ?? 'All').trim().toLowerCase();
      const athletes = boards.flat()
        .filter(({ entry }) => {
          const age = String(entry.ageGroupKey ?? entry.ageGroup ?? '').trim().toLowerCase();
          const gender = String(entry.genderKey ?? entry.gender ?? '').trim().toLowerCase();
          return (!ageQuery || age === ageQuery)
            && (genderQuery === 'all' || gender.startsWith(genderQuery));
        })
        .map(({ entry, contest }) => {
          // Older canonical leaderboard artifacts did not carry privacy. Never
          // infer PUBLIC from that absence: doing so would expose an anonymous
          // athlete's name and bib through the mobile direct-artifact fallback.
          // New builds publish trackingVisibility explicitly, so this fallback
          // naturally becomes exact after the next canonical rebuild.
          const visibility = String(entry.trackingVisibility ?? '').trim().toUpperCase() === 'PUBLIC'
            ? 'PUBLIC'
            : 'ANONYMOUS';
          const anonymous = visibility === 'ANONYMOUS';
          return {
            ...entry,
            athleteId: anonymous ? `anonymous:${entry.rank}:${contest.providerContestUuid ?? contest.bergmanTicketId ?? 'contest'}` : String(entry.participantUuid ?? entry.athleteId ?? ''),
            participantUuid: anonymous ? '' : String(entry.participantUuid ?? ''),
            providerParticipantUuid: anonymous ? '' : String(entry.providerParticipantUuid ?? ''),
            name: anonymous ? 'Anonymous Athlete' : String(entry.displayName ?? entry.name ?? ''),
            displayName: anonymous ? 'Anonymous Athlete' : String(entry.displayName ?? entry.name ?? ''),
            bib: anonymous ? '' : String(entry.bib ?? ''),
            bibNumber: anonymous ? '' : String(entry.bib ?? ''),
            photoUrl: anonymous ? null : entry.photoUrl,
            clubName: anonymous ? null : entry.clubName,
            countryCode: anonymous ? null : entry.countryCode,
            contest: String(contest.displayName ?? contest.providerContestUuid ?? contest.bergmanTicketId ?? ''),
            ageGroup: String(entry.ageGroupKey ?? entry.ageGroup ?? ''),
            gender: String(entry.genderKey ?? entry.gender ?? ''),
            currentLeg: String(entry.currentLeg ?? entry.legType ?? ''),
            overallTime: formatElapsed(entry.elapsedSeconds),
            overallRank: Number(entry.rank),
            gap: entry.gap ?? '—',
            trackingVisibility: visibility,
            liveTrackingVisibility: visibility,
            visibility,
          };
        })
        .slice(0, filters.limit ?? 100) as unknown as LeaderboardResponse['athletes'];
      return {
        success: true,
        eventId,
        athletes,
        contest: filters.contest,
        ageGroup: filters.ageGroup,
        gender: filters.gender ?? 'All',
        count: athletes.length,
        total: athletes.length,
        source: 'canonical',
      };
    } catch (canonicalError) {
      if (signal?.aborted) throw canonicalError;
    }

    const response = await liveApi.json<LegacyResponse>(`/api/live/leaderboard/${eventId}`, {
      params: {
        contest: filters.contest,
        ageGroup: filters.ageGroup,
        gender: filters.gender ?? 'All',
        limit: filters.limit ?? 100,
      },
      signal,
    });
    const athletes = Array.isArray(response.athletes)
      ? response.athletes
      : Array.isArray(response.leaderboard?.rows)
        ? response.leaderboard.rows
        : Array.isArray(response.leaderboard?.athletes)
          ? response.leaderboard.athletes
          : Array.isArray(response.rows)
            ? response.rows
            : [];
    return {
      ...response,
      athletes,
      count: Number(response.count ?? athletes.length),
      source: response.source || 'live_event_leaderboard',
    };
  },
};
