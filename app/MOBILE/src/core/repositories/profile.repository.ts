import { authenticatedJson, authenticatedUpload } from '@/core/auth/authenticatedFetch';
import { getCountryDisplayName } from '@/core/utils';
import type { Registration, Visibility } from '@/core/types';

export type TrackingVisibility = 'PUBLIC' | 'ANONYMOUS';

/**
 * Profile repository. The mobile app is another client of the existing BERGMAN
 * backend — NOT a parallel service. It must not read Firestore directly and must
 * not introduce a separate `/api/me` backend; profile data comes through the
 * existing backend REST (Bearer Firebase ID token).
 *
 * Data model (matches the platform):
 *   • Athlete profile is GLOBAL — name/email/`profilePhotoUrl`/club/city/country
 *     are stored once and reused across every event.
 *   • Live tracking privacy is account-level (`trackingVisibility` /
 *     `liveTrackingPrivacy`) and mirrored to live indexes by the backend.
 */
export type AthleteProfile = {
  /** Global athlete id (Firebase uid on the BERGMAN backend). */
  id?: string;
  uid: string;
  email: string | null;
  name?: string | null;
  /** Stored once, reused everywhere (athlete detail, leaderboard, map, results). */
  profilePhotoUrl?: string | null;
  profileUrl?: string | null;
  profileURL?: string | null;
  mobile?: string | null;
  role?: 'athlete' | 'club' | 'volunteer' | 'admin';
  isAdmin?: boolean;
  isVolunteer?: boolean;
  club?: { id: string; name: string } | null;
  clubName?: string | null;
  currentAffiliation?: { id?: string | null; clubId?: string | null; name?: string | null; clubName?: string | null; displayName?: string | null } | null;
  currentClub?: { id?: string | null; clubId?: string | null; name?: string | null; clubName?: string | null; displayName?: string | null } | null;
  activeClub?: { id?: string | null; clubId?: string | null; name?: string | null; clubName?: string | null; displayName?: string | null } | null;
  ownedClub?: { id?: string; name?: string } | null;
  city?: string | null;
  country?: string | null;
  privacy?: Visibility | null;
  trackingVisibility?: TrackingVisibility | null;
  liveTrackingPrivacy?: TrackingVisibility | null;
  privacyUpdatedAt?: string | null;
  privacyUpdatedBy?: string | null;
  statistics?: { totalRaces: number; podiums: number; points: number };
  badges?: string[];
  rankings?: { overall?: number; category?: number };
  certificates?: { id: string; eventTitle: string; dateLabel: string }[];
  /** Per-event registrations (carry bib/category/status + visibility). */
  registrations?: Registration[];
  upcomingRaces?: { eventId: string; eventName: string; dateLabel: string }[];
  pastRaces?: { eventId: string; eventName: string; dateLabel: string; finishTime?: string }[];
  preferences?: { units: 'metric' | 'imperial' };
};

/** Editable profile fields (global athlete attributes). */
export type ProfilePatch = Partial<{
  name: string | null;
  mobile: string | null;
  city: string | null;
  country: string | null;
  club: { id: string; name: string } | null;
  privacy: Visibility | null;
  visibility: Visibility | null;
  liveTrackingPrivacy: Visibility | null;
  trackingVisibility: Visibility | null;
  liveTrackingVisibility: Visibility | null;
  preferences: { units: 'metric' | 'imperial' };
}>;

/** Local image reference for a multipart photo upload. */
export type ProfilePhotoUpload = { uri: string; name?: string; type?: string };

/**
 * Shared BERGMAN athlete endpoints — used by the mobile app against the Mobile
 * API Worker. Reads use the dashboard aggregate because the Worker composes the
 * logged-in athlete profile, registrations, BEL data, and certificates there.
 * Mutations still use the profile endpoint. All calls are authenticated
 * (Bearer Firebase ID token).
 */
export interface IProfileRepository {
  /** GET /api/dashboard — the current authenticated athlete aggregate. */
  getProfile(): Promise<AthleteProfile>;
  /** PATCH /api/athletes/profile — update global profile fields. */
  updateProfile(patch: ProfilePatch): Promise<AthleteProfile>;
  /** PATCH /api/athletes/profile/privacy — update account-wide live tracking visibility. */
  updateTrackingPrivacy(visibility: TrackingVisibility): Promise<AthleteProfile>;
  /** POST /api/athletes/profile/photo — upload/replace photo; returns its URL. */
  uploadPhoto(photo: ProfilePhotoUpload): Promise<{ profilePhotoUrl: string }>;
  /** DELETE /api/athletes/profile/photo — remove photo. */
  removePhoto(): Promise<void>;
  /** Derived from GET /api/athletes/profile — all event registrations for the athlete. */
  getRegistrations(): Promise<Registration[]>;
  /** PATCH /api/events/{eventId}/registration/privacy — per-event visibility. */
  updateEventPrivacy(eventId: string, visibility: Visibility): Promise<Registration>;
}

const PROFILE = '/api/athletes/profile';
const PROFILE_READ = '/api/mobile/user/me';

function toText(value: unknown): string {
  return String(value ?? '').trim();
}

function looksLikeClubId(value: unknown): boolean {
  const text = toText(value);
  if (!text) return false;
  if (text.length >= 12 && /[A-Za-z]/.test(text) && /\d/.test(text)) return true;
  if (/^[A-Za-z0-9_-]{16,}$/.test(text)) return true;
  return false;
}

function resolvePhoto(...values: (string | null | undefined)[]): string | null {
  for (const value of values) {
    const candidate = toText(value);
    if (candidate) return candidate;
  }
  return null;
}

function normalizeTrackingVisibility(value: unknown): TrackingVisibility {
  return toText(value).toUpperCase() === 'ANONYMOUS' ? 'ANONYMOUS' : 'PUBLIC';
}

function normalizeVisibility(value: unknown): Visibility {
  const normalized = toText(value).toUpperCase();
  if (normalized === 'PRIVATE' || normalized === 'OFFICIALS_ONLY' || normalized === 'OFFICIALS ONLY') return 'ANONYMOUS';
  if (normalized === 'ANONYMOUS' || normalized === 'ANON') return 'ANONYMOUS';
  return 'PUBLIC';
}

function resolveClubDisplayName(source: Record<string, unknown>): string | null {
  const clubObject = source.club && typeof source.club === 'object' ? (source.club as Record<string, unknown>) : null;
  const currentClubObject = source.currentClub && typeof source.currentClub === 'object' ? (source.currentClub as Record<string, unknown>) : null;
  const activeClubObject = source.activeClub && typeof source.activeClub === 'object' ? (source.activeClub as Record<string, unknown>) : null;
  const currentAffiliationObject = source.currentAffiliation && typeof source.currentAffiliation === 'object'
    ? (source.currentAffiliation as Record<string, unknown>)
    : null;
  const clubCandidates = [
    currentAffiliationObject?.name,
    currentAffiliationObject?.clubName,
    currentAffiliationObject?.displayName,
    source.currentClubName,
    currentClubObject?.name,
    currentClubObject?.clubName,
    currentClubObject?.displayName,
    activeClubObject?.name,
    activeClubObject?.clubName,
    activeClubObject?.displayName,
    source.currentAffiliationName,
    source.affiliatedClubName,
    source.displayClub,
    source.club_name,
    clubObject?.name,
    clubObject?.clubName,
    clubObject?.displayName,
    source.affiliatedClub,
  ];

  for (const candidate of clubCandidates) {
    const text = toText(candidate);
    if (text && !looksLikeClubId(text)) {
      return text;
    }
  }

  return null;
}

function buildTrackingPrivacyBodies(visibility: TrackingVisibility): Record<string, unknown>[] {
  return [
    { trackingVisibility: visibility, liveTrackingPrivacy: visibility },
  ];
}

function unwrapProfilePayload(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== 'object') return {};
  const record = payload as Record<string, unknown>;
  if ('data' in record && record.data && typeof record.data === 'object') {
    const data = record.data as Record<string, unknown>;
    if (data.athlete && typeof data.athlete === 'object') return { ...data, ...(data.athlete as Record<string, unknown>) };
    if (data.profile && typeof data.profile === 'object') return { ...data, ...(data.profile as Record<string, unknown>) };
    return data;
  }
  if ('profile' in record && record.profile && typeof record.profile === 'object') {
    return { ...record, ...(record.profile as Record<string, unknown>) };
  }
  if ('athlete' in record && record.athlete && typeof record.athlete === 'object') return record.athlete as Record<string, unknown>;
  if ('dashboard' in record && record.dashboard && typeof record.dashboard === 'object') {
    const dashboard = record.dashboard as Record<string, unknown>;
    if (dashboard.athlete && typeof dashboard.athlete === 'object') return { ...dashboard, ...(dashboard.athlete as Record<string, unknown>) };
    if (dashboard.profile && typeof dashboard.profile === 'object') return { ...dashboard, ...(dashboard.profile as Record<string, unknown>) };
    return dashboard;
  }
  return record;
}

function normalizeProfileResponse(payload: unknown): AthleteProfile {
  const source = unwrapProfilePayload(payload);
  const countryValue = (() => {
    const nestedCountry = source.country && typeof source.country === 'object' ? (source.country as Record<string, unknown>) : null;
    const resolvedCountry = getCountryDisplayName(toText(
      source.country ||
      source.countryName ||
      source.nationality ||
      source.countryCode ||
      source.country_code ||
      nestedCountry?.name ||
      nestedCountry?.code ||
      nestedCountry?.label,
    ));
    return resolvedCountry || null;
  })();
  const clubObject = source.club && typeof source.club === 'object' ? (source.club as Record<string, unknown>) : null;
  const currentClubObject = source.currentClub && typeof source.currentClub === 'object' ? (source.currentClub as Record<string, unknown>) : null;
  const activeClubObject = source.activeClub && typeof source.activeClub === 'object' ? (source.activeClub as Record<string, unknown>) : null;
  const currentAffiliationObject = source.currentAffiliation && typeof source.currentAffiliation === 'object'
    ? (source.currentAffiliation as Record<string, unknown>)
    : null;
  const ownedClub = source.ownedClub && typeof source.ownedClub === 'object' ? (source.ownedClub as Record<string, unknown>) : null;
  const resolvedClubName = resolveClubDisplayName(source);
  const resolvedClubId = toText(
    currentAffiliationObject?.clubId ||
    currentAffiliationObject?.id ||
    activeClubObject?.clubId ||
    activeClubObject?.id ||
    currentClubObject?.clubId ||
    currentClubObject?.id ||
    source.clubId ||
    source.club_id ||
    source.clubUID ||
    source.clubUid ||
    source.ownedClubId ||
    ownedClub?.id ||
    currentClubObject?.id ||
    currentClubObject?.clubId ||
    (clubObject ? (toText(clubObject.id) || toText(clubObject.clubId)) : '') ||
    source.affiliatedClubId,
  );
  const clubValue = resolvedClubName || resolvedClubId ? {
    id: resolvedClubId || resolvedClubName || 'Club',
    name: resolvedClubName || resolvedClubId || 'Club',
  } : null;

  const registrations = Array.isArray(source.registrations)
    ? (source.registrations as Registration[])
    : Array.isArray(source.registeredEvents)
      ? (source.registeredEvents as Registration[])
      : [];

  const upcomingRaces = Array.isArray(source.upcomingRaces)
    ? (source.upcomingRaces as AthleteProfile['upcomingRaces'])
    : registrations.map((item: any) => ({
        eventId: toText(item?.eventId || item?.id),
        eventName: toText(item?.eventName || item?.event || item?.name) || 'Event',
        dateLabel: toText(item?.dateLabel || item?.eventDate || item?.date) || '—',
      }));

  const pastRaces = Array.isArray(source.pastRaces)
    ? (source.pastRaces as AthleteProfile['pastRaces'])
    : Array.isArray(source.raceHistory)
      ? (source.raceHistory as any[]).map((item: any) => ({
          eventId: toText(item?.eventId || item?.id),
          eventName: toText(item?.eventName || item?.event || item?.name) || 'Event',
          dateLabel: toText(item?.dateLabel || item?.raceDate || item?.date) || '—',
          finishTime: toText(item?.finishTime || item?.chipTime) || undefined,
        }))
      : Array.isArray(source.results)
        ? (source.results as any[]).map((item: any) => ({
            eventId: toText(item?.eventId || item?.id),
            eventName: toText(item?.eventName || item?.event || item?.name) || 'Event',
            dateLabel: toText(item?.dateLabel || item?.raceDate || item?.date) || '—',
            finishTime: toText(item?.finishTime || item?.chipTime) || undefined,
          }))
        : [];

  return {
    id: toText(source.id) || undefined,
    uid: toText(source.uid || source.id),
    email: source.email != null ? String(source.email) : null,
    name: toText(source.name || source.fullName) || null,
    profilePhotoUrl: resolvePhoto(
      source.profilePhotoUrl as string | null | undefined,
      source.profileUrl as string | null | undefined,
      source.profileURL as string | null | undefined,
      source.photoUrl as string | null | undefined,
      source.photoURL as string | null | undefined,
    ),
    profileUrl: resolvePhoto(
      source.profileUrl as string | null | undefined,
      source.profileURL as string | null | undefined,
      source.profilePhotoUrl as string | null | undefined,
      source.photoUrl as string | null | undefined,
      source.photoURL as string | null | undefined,
    ),
    profileURL: resolvePhoto(
      source.profileURL as string | null | undefined,
      source.profileUrl as string | null | undefined,
      source.profilePhotoUrl as string | null | undefined,
      source.photoUrl as string | null | undefined,
      source.photoURL as string | null | undefined,
    ),
    mobile: source.mobile != null ? String(source.mobile) : null,
    role: (source.role as AthleteProfile['role']) ?? undefined,
    isAdmin: typeof source.isAdmin === 'boolean' ? source.isAdmin : source.role === 'admin',
    isVolunteer: typeof source.isVolunteer === 'boolean' ? source.isVolunteer : undefined,
    club: clubValue,
    // Preserve raw club-affiliation hints for UI fallbacks.
    // These are not part of the original public profile contract, but the
    // mobile client uses them when the backend returns richer KV payloads.
    clubName: resolvedClubName || null,
    currentAffiliation: currentAffiliationObject ? {
      id: toText(currentAffiliationObject.id) || null,
      clubId: toText(currentAffiliationObject.clubId) || null,
      name: toText(currentAffiliationObject.name) || null,
      clubName: toText(currentAffiliationObject.clubName) || null,
      displayName: toText(currentAffiliationObject.displayName) || null,
    } : null,
    currentClub: currentClubObject ? {
      id: toText(currentClubObject.id) || null,
      clubId: toText(currentClubObject.clubId) || null,
      name: toText(currentClubObject.name) || null,
      clubName: toText(currentClubObject.clubName) || null,
      displayName: toText(currentClubObject.displayName) || null,
    } : null,
    activeClub: activeClubObject ? {
      id: toText(activeClubObject.id) || null,
      clubId: toText(activeClubObject.clubId) || null,
      name: toText(activeClubObject.name) || null,
      clubName: toText(activeClubObject.clubName) || null,
      displayName: toText(activeClubObject.displayName) || null,
    } : null,
    city: source.city != null ? String(source.city) : null,
    country: countryValue,
    privacy: normalizeVisibility(source.privacy ?? source.visibility ?? source.trackingVisibility ?? source.liveTrackingPrivacy),
    trackingVisibility: normalizeTrackingVisibility(source.trackingVisibility ?? source.liveTrackingPrivacy ?? source.privacy ?? source.visibility),
    liveTrackingPrivacy: normalizeTrackingVisibility(source.liveTrackingPrivacy ?? source.trackingVisibility ?? source.privacy ?? source.visibility),
    privacyUpdatedAt: toText(source.privacyUpdatedAt) || null,
    privacyUpdatedBy: toText(source.privacyUpdatedBy) || null,
    statistics: (source.statistics as AthleteProfile['statistics']) ?? undefined,
    badges: Array.isArray(source.badges) ? (source.badges as string[]) : undefined,
    rankings: (source.rankings as AthleteProfile['rankings']) ?? (source.ranking as AthleteProfile['rankings']) ?? undefined,
    certificates: Array.isArray(source.certificates) ? (source.certificates as AthleteProfile['certificates']) : undefined,
    registrations,
    upcomingRaces,
    pastRaces,
    preferences: (source.preferences as AthleteProfile['preferences']) ?? { units: 'metric' },
  };
}

export const ProductionProfileRepository: IProfileRepository = {
  async getProfile() {
    try {
      return normalizeProfileResponse(await authenticatedJson<unknown>(PROFILE_READ));
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (status === 404) {
        return normalizeProfileResponse({});
      }
      throw error;
    }
  },
  updateProfile(patch) {
    return authenticatedJson<unknown>(PROFILE, { method: 'PATCH', body: patch }).then(normalizeProfileResponse);
  },
  async updateTrackingPrivacy(visibility) {
    const body = buildTrackingPrivacyBodies(visibility)[0];
    return normalizeProfileResponse(
      await authenticatedJson<unknown>(PROFILE, {
        method: 'PATCH',
        body,
      }),
    );
  },
  uploadPhoto(photo) {
    const form = new FormData();
    // React Native file part; typed as Blob for the DOM FormData signature.
    form.append('photo', {
      uri: photo.uri,
      name: photo.name ?? 'profile.jpg',
      type: photo.type ?? 'image/jpeg',
    } as unknown as Blob);
    return authenticatedUpload<{ profilePhotoUrl: string }>(`${PROFILE}/photo`, form);
  },
  removePhoto() {
    return authenticatedJson<void>(`${PROFILE}/photo`, { method: 'DELETE' });
  },
  async getRegistrations() {
    try {
      const profile = await ProductionProfileRepository.getProfile();
      if (Array.isArray(profile.registrations)) {
        return profile.registrations;
      }
      return [];
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (status === 404) return [];
      throw error;
    }
  },
  updateEventPrivacy(eventId, visibility) {
    return authenticatedJson<Registration>(
      `/api/events/${encodeURIComponent(eventId)}/registration/privacy`,
      { method: 'PATCH', body: { liveTrackingVisibility: visibility } },
    );
  },
};
