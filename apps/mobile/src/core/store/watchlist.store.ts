import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";

/**
 * Watchlist client cache (Zustand). Authenticated account state is reconciled
 * from the backend; AsyncStorage keeps the last known rows for offline use.
 */
const KEY = "raceupshot.watchlist";

export type TrackedAthlete = {
  id: string;
  /** Exact account-watchlist item ID returned by the backend. */
  watchlistItemId?: string;
  bib: string;
  name: string;
  eventId?: string;
  category?: string;
  ageGroup?: string;
  club?: string;
  photoUrl?: string;
  email?: string;
  participantUuid?: string;
  providerUuid?: string;
  providerAthleteUuid?: string;
  providerTimingUuid?: string;
  providerRecordId?: string;
  athleteUid?: string;
  bookingId?: string;
  contestId?: string;
  contestUuid?: string;
  providerContestUuid?: string;
  providerContestId?: string;
  ticketId?: string;
  raceDate?: string;
  trackingVisibility?: string;
  liveTrackingPrivacy?: string;
  privacy?: string;
  liveTrackingVisibility?: string;
  searchVisible?: boolean;
  mapVisible?: boolean;
  modalVisible?: boolean;
  anonymous?: boolean;
  viewerCanSeeIdentity?: boolean;
  privacyMasked?: boolean;
};

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function storageKey(accountId?: string | null): string {
  return `${KEY}.${text(accountId) || "guest"}`;
}

function athleteIdentityValues(athlete: Partial<TrackedAthlete>): string[] {
  return [
    athlete.id,
    athlete.bib,
    athlete.athleteUid,
    athlete.participantUuid,
    athlete.providerUuid,
    athlete.providerAthleteUuid,
    athlete.providerTimingUuid,
    athlete.providerRecordId,
    athlete.bookingId,
  ]
    .map(text)
    .filter(Boolean);
}

function matchesAthleteIdentity(
  athlete: Partial<TrackedAthlete>,
  id: string,
  eventId?: string,
): boolean {
  if (eventId && text(athlete.eventId) !== text(eventId)) return false;
  const candidate = text(id).replace(`${text(eventId)}:`, "");
  return athleteIdentityValues(athlete).includes(candidate);
}

function dedupeAthletes(athletes: TrackedAthlete[]): TrackedAthlete[] {
  const rows: TrackedAthlete[] = [];
  for (const athlete of athletes) {
    const placeholderOnly =
      text(athlete.id) === text(athlete.bib) &&
      text(athlete.name) === `Bib ${text(athlete.bib)}` &&
      !text(athlete.athleteUid) &&
      !text(athlete.participantUuid) &&
      !text(athlete.providerUuid) &&
      !text(athlete.providerAthleteUuid) &&
      !text(athlete.providerTimingUuid) &&
      !text(athlete.providerRecordId) &&
      !text(athlete.bookingId);
    if (placeholderOnly) continue;
    const event = text(athlete.eventId).toLowerCase();
    const identities = new Set(
      athleteIdentityValues(athlete).map(
        (value) => `${event}:${value.toLowerCase()}`,
      ),
    );
    const existingIndex = rows.findIndex((row) => {
      if (text(row.eventId).toLowerCase() !== event) return false;
      return athleteIdentityValues(row).some((value) =>
        identities.has(`${event}:${value.toLowerCase()}`),
      );
    });
    if (existingIndex < 0) {
      rows.push(athlete);
      continue;
    }
    const existing = rows[existingIndex];
    rows[existingIndex] = Object.fromEntries(
      Object.entries({ ...athlete, ...existing }).filter(
        ([, value]) => value !== undefined && value !== null && value !== "",
      ),
    ) as TrackedAthlete;
  }
  return rows;
}

async function persist(
  athletes: TrackedAthlete[],
  accountId?: string | null,
): Promise<void> {
  const value = JSON.stringify(athletes);
  const key = storageKey(accountId);
  try {
    await AsyncStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

function normalizeStored(value: unknown): TrackedAthlete[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === "string")
        return { id: item, bib: item, name: `Bib ${item}` } as TrackedAthlete;
      const obj = item as Partial<TrackedAthlete>;
      const id = obj.id ?? obj.bib;
      if (!id) return undefined;
      return {
        id,
        watchlistItemId: obj.watchlistItemId,
        bib: obj.bib ?? id,
        name: obj.name ?? `Bib ${obj.bib ?? id}`,
        eventId: obj.eventId,
        category: obj.category,
        ageGroup: obj.ageGroup,
        club: obj.club,
        photoUrl: obj.photoUrl,
        email: obj.email,
        participantUuid: obj.participantUuid,
        providerUuid: obj.providerUuid,
        providerAthleteUuid: obj.providerAthleteUuid,
        providerTimingUuid: obj.providerTimingUuid,
        providerRecordId: obj.providerRecordId,
        athleteUid: obj.athleteUid,
        bookingId: obj.bookingId,
        contestId: obj.contestId,
        contestUuid: obj.contestUuid,
        providerContestUuid: obj.providerContestUuid,
        providerContestId: obj.providerContestId,
        ticketId: obj.ticketId,
        raceDate: obj.raceDate,
      } as TrackedAthlete;
    })
    .filter((item): item is TrackedAthlete => Boolean(item));
}

async function load(accountId?: string | null): Promise<TrackedAthlete[]> {
  const key = storageKey(accountId);
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? normalizeStored(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

type WatchlistState = {
  ids: string[];
  athletes: TrackedAthlete[];
  hydrated: boolean;
  accountId: string | null;
  hydrate: (accountId?: string | null) => Promise<void>;
  clearAccount: (accountId?: string | null) => Promise<void>;
  replaceAthletes: (athletes: TrackedAthlete[]) => void;
  isWatched: (id: string, eventId?: string) => boolean;
  addAthlete: (athlete: TrackedAthlete) => void;
  toggle: (id: string, eventId?: string) => void;
};

export const useWatchlistStore = create<WatchlistState>((set, get) => ({
  ids: [],
  athletes: [],
  hydrated: false,
  accountId: null,
  hydrate: async (accountId = null) => {
    const normalizedAccountId = text(accountId) || null;
    if (get().hydrated && get().accountId === normalizedAccountId) return;
    set({
      athletes: [],
      ids: [],
      hydrated: false,
      accountId: normalizedAccountId,
    });
    const storedAthletes = dedupeAthletes(await load(normalizedAccountId));
    if (get().accountId !== normalizedAccountId) return;
    // An athlete can be added while AsyncStorage is still loading (especially
    // for guests opening Live Tracking during Firebase startup). Keep those
    // optimistic rows instead of replacing them with the older stored value.
    const athletes = dedupeAthletes([...get().athletes, ...storedAthletes]);
    set({ athletes, ids: athletes.map((a) => a.id), hydrated: true });
    void persist(athletes, normalizedAccountId);
  },
  clearAccount: async (accountId = null) => {
    const normalizedAccountId = text(accountId) || null;
    await AsyncStorage.removeItem(storageKey(normalizedAccountId));
    if (get().accountId === normalizedAccountId) {
      set({ athletes: [], ids: [], hydrated: false, accountId: null });
    }
  },
  replaceAthletes: (athletes) => {
    const next = dedupeAthletes(athletes);
    set({
      athletes: next,
      ids: next.map((athlete) => athlete.id),
      hydrated: true,
    });
    void persist(next, get().accountId);
  },
  isWatched: (id, eventId) =>
    get().athletes.some((athlete) =>
      matchesAthleteIdentity(athlete, id, eventId),
    ),
  addAthlete: (athlete) => {
    const next = dedupeAthletes([athlete, ...get().athletes]);
    set({ athletes: next, ids: next.map((a) => a.id) });
    void persist(next, get().accountId);
  },
  toggle: (id, eventId) => {
    // Optimistic update, then persist.
    const exists = get().athletes.some((athlete) =>
      matchesAthleteIdentity(athlete, id, eventId),
    );
    // Tracking additions must use addAthlete so complete identity data is
    // stored. A bare-ID toggle is removal-only; manufacturing a `Bib <id>` row
    // is what caused ghost athletes after an identity mismatch.
    if (!exists) return;
    const next = get().athletes.filter(
      (athlete) => !matchesAthleteIdentity(athlete, id, eventId),
    );
    set({ athletes: next, ids: next.map((a) => a.id) });
    void persist(next, get().accountId);
  },
}));
