import { useCallback, useEffect, useMemo, useRef } from "react";
import { Alert } from "react-native";
import { useQuery } from "@tanstack/react-query";

import { repositories } from "@/core/repositories";
import { useSession } from "@/core/auth";
import { promptTrackedAthleteNotifications } from "@/core/services/notifications";
import { useWatchlistStore, type TrackedAthlete } from "@/core/store";

type ResolvedAthlete = {
  id: string;
  watchlistItemId?: string;
  participantUuid?: string;
  bib: string;
  name: string;
  eventId?: string;
  category?: string;
  ageGroup?: string;
  club?: string;
  photoUrl?: string;
  email?: string;
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

function cleanContestLabel(value: unknown): string {
  const textValue = text(value);
  if (!textValue) return "";
  if (/^sub-\d+$/i.test(textValue)) return "";
  return textValue;
}

function isPublicTrackableParticipant(
  participant: Record<string, unknown>,
): boolean {
  const registration =
    participant.registration && typeof participant.registration === "object"
      ? (participant.registration as Record<string, unknown>)
      : undefined;
  const visibility = text(
    participant.trackingVisibility ??
      participant.liveTrackingPrivacy ??
      participant.privacy ??
      participant.liveTrackingVisibility ??
      participant.visibility ??
      registration?.trackingVisibility ??
      registration?.liveTrackingPrivacy,
  ).toUpperCase();
  if (
    participant.viewerCanSeeIdentity === true ||
    participant.privacyMasked === false
  ) {
    return (
      participant.searchVisible !== false &&
      participant.mapVisible !== false &&
      participant.modalVisible !== false
    );
  }
  if (
    visibility === "ANONYMOUS" ||
    visibility === "ANON" ||
    visibility === "PRIVATE" ||
    visibility === "OFFICIALS_ONLY" ||
    participant.anonymous === true
  ) {
    return false;
  }
  return (
    participant.searchVisible !== false &&
    participant.mapVisible !== false &&
    participant.modalVisible !== false
  );
}

function resolveFromRoster(
  eventId: string | undefined,
  ids: string[],
  roster: Record<string, unknown>[],
) {
  if (!eventId || roster.length === 0) return [];
  const wanted = new Set(ids.map((value) => value.trim()).filter(Boolean));
  return roster
    .filter((participant) => {
      if (!isPublicTrackableParticipant(participant)) return false;
      const provider =
        participant.provider && typeof participant.provider === "object"
          ? (participant.provider as Record<string, unknown>)
          : undefined;
      const candidateIds = [
        text(participant.participantUuid),
        text(participant.providerUuid),
        text(participant.providerAthleteUuid),
        text(participant.providerTimingUuid),
        text(participant.providerRecordId),
        text(participant.bookingId),
        text(participant.athleteUid),
        text(provider?.providerUuid),
        text(participant.bib),
      ].filter(Boolean);
      return candidateIds.some((value) => wanted.has(value));
    })
    .map((participant) => {
      const provider =
        participant.provider && typeof participant.provider === "object"
          ? (participant.provider as Record<string, unknown>)
          : undefined;
      return {
        id:
          text(participant.participantUuid) ||
          text(participant.providerUuid) ||
          text(participant.providerAthleteUuid) ||
          text(participant.providerRecordId) ||
          text(participant.bookingId) ||
          text(provider?.providerUuid) ||
          text(participant.bib),
        participantUuid: text(participant.participantUuid) || undefined,
        bib: text(participant.bib),
        name:
          text(participant.displayName) ||
          text(participant.name) ||
          text(participant.fullName) ||
          `Bib ${text(participant.bib)}`,
        eventId,
        category:
          cleanContestLabel(participant.contestName) ||
          cleanContestLabel(participant.providerContestName) ||
          cleanContestLabel(participant.ageGroupName) ||
          cleanContestLabel(participant.ageGroup),
        ageGroup:
          text(participant.ageGroup) ||
          text(participant.ageGroupName) ||
          text(participant.categoryName) ||
          undefined,
        club: text(participant.club) || text(participant.clubName),
        photoUrl:
          text(participant.profilePhotoUrl) ||
          text(participant.photoUrl) ||
          text(participant.photoURL) ||
          text(participant.avatarUrl) ||
          text(participant.displayPhoto) ||
          undefined,
        email: text(participant.email) || undefined,
        providerUuid:
          text(participant.providerUuid) ||
          text(participant.participantUuid) ||
          text(participant.providerAthleteUuid) ||
          text(participant.providerRecordId) ||
          text(participant.bookingId) ||
          text(provider?.providerUuid) ||
          undefined,
        providerAthleteUuid: text(participant.providerAthleteUuid) || undefined,
        providerTimingUuid: text(participant.providerTimingUuid) || undefined,
        athleteUid: text(participant.athleteUid) || undefined,
        providerRecordId: text(participant.providerRecordId) || undefined,
        bookingId: text(participant.bookingId) || undefined,
        contestId:
          text(participant.contestId) ||
          text(participant.contestUuid) ||
          text(participant.providerContestUuid) ||
          undefined,
        contestUuid: text(participant.contestUuid) || undefined,
        providerContestUuid: text(participant.providerContestUuid) || undefined,
        providerContestId: text(participant.providerContestId) || undefined,
        ticketId: text(participant.ticketId) || undefined,
        trackingVisibility:
          text(participant.trackingVisibility) || undefined,
        liveTrackingPrivacy:
          text(participant.liveTrackingPrivacy) || undefined,
        privacy: text(participant.privacy) || undefined,
        liveTrackingVisibility:
          text(participant.liveTrackingVisibility) || undefined,
        searchVisible: participant.searchVisible !== false,
        mapVisible: participant.mapVisible !== false,
        modalVisible: participant.modalVisible !== false,
        viewerCanSeeIdentity: participant.viewerCanSeeIdentity === true,
        privacyMasked: participant.privacyMasked === true,
        anonymous:
          participant.viewerCanSeeIdentity === true
            ? false
            : participant.anonymous === true,
      };
    }) satisfies ResolvedAthlete[];
}

function resolveAthleteId(athlete: Partial<ResolvedAthlete>): string {
  return (
    text(athlete.athleteUid) ||
    text(athlete.providerAthleteUuid) ||
    text(athlete.participantUuid) ||
    text(athlete.providerUuid) ||
    text(athlete.providerRecordId) ||
    text(athlete.bookingId) ||
    text(athlete.id) ||
    text(athlete.bib)
  );
}

function resolveContestId(athlete: Partial<ResolvedAthlete>): string {
  return (
    text(athlete.contestId) ||
    text(athlete.contestUuid) ||
    text(athlete.providerContestUuid) ||
    text(athlete.providerContestId) ||
    text(athlete.category)
  );
}

function matchesResolvedAthleteId(
  athlete: Partial<ResolvedAthlete>,
  id: string,
  eventId?: string,
): boolean {
  if (eventId && text(athlete.eventId) !== text(eventId)) return false;
  const candidate = text(id).replace(`${text(eventId)}:`, "");
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
    .filter(Boolean)
    .includes(candidate);
}

function athleteIdentityValues(athlete: Partial<ResolvedAthlete>): string[] {
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

function dedupeResolvedAthletes(
  athletes: ResolvedAthlete[],
  fallbackEventId?: string,
): ResolvedAthlete[] {
  const rows: ResolvedAthlete[] = [];
  for (const athlete of athletes) {
    const event = text(athlete.eventId || fallbackEventId).toLowerCase();
    const identities = new Set(
      athleteIdentityValues(athlete).map(
        (value) => `${event}:${value.toLowerCase()}`,
      ),
    );
    const existingIndex = rows.findIndex((row) => {
      if (text(row.eventId || fallbackEventId).toLowerCase() !== event)
        return false;
      const identityMatch = athleteIdentityValues(row).some((value) =>
        identities.has(`${event}:${value.toLowerCase()}`),
      );
      if (identityMatch) return true;
      const sameName = text(row.name).toLowerCase() === text(athlete.name).toLowerCase();
      const oneSideIsLegacy = isPlaceholderBib(row.bib) || isPlaceholderBib(athlete.bib);
      return Boolean(sameName && text(row.name) && oneSideIsLegacy);
    });
    if (existingIndex < 0) {
      rows.push(athlete);
      continue;
    }
    const existing = rows[existingIndex];
    const preferIncoming = isPlaceholderBib(existing.bib) && !isPlaceholderBib(athlete.bib);
    const preferred = preferIncoming ? athlete : existing;
    const fallback = preferIncoming ? existing : athlete;
    rows[existingIndex] = Object.fromEntries(
      Object.entries({ ...fallback, ...preferred }).filter(
        ([, value]) => value !== undefined && value !== null && value !== "",
      ),
    ) as ResolvedAthlete;
  }
  return rows;
}

async function subscribeTrackedAthlete(
  athlete: Partial<ResolvedAthlete>,
  fallbackEventId?: string,
) {
  const athleteId = resolveAthleteId(athlete);
  const eventId = text(athlete.eventId) || fallbackEventId;
  if (!athleteId || !eventId) return;
  await repositories.trackingSubscriptions.subscribe({
    ...athlete,
    eventId,
    athleteId,
    bib: text(athlete.bib) || null,
    contestId: resolveContestId(athlete) || null,
    name: text(athlete.name) || null,
    category: text(athlete.category) || null,
    ageGroup: text(athlete.ageGroup) || null,
    club: text(athlete.club) || null,
    photoUrl: text(athlete.photoUrl) || null,
    participantUuid: text(athlete.participantUuid) || null,
    providerUuid: text(athlete.providerUuid) || null,
    providerAthleteUuid: text(athlete.providerAthleteUuid) || null,
    providerTimingUuid: text(athlete.providerTimingUuid) || null,
    providerRecordId: text(athlete.providerRecordId) || null,
    athleteUid: text(athlete.athleteUid) || null,
    bookingId: text(athlete.bookingId) || null,
    contestUuid: text(athlete.contestUuid) || null,
    providerContestUuid: text(athlete.providerContestUuid) || null,
    providerContestId: text(athlete.providerContestId) || null,
    ticketId: text(athlete.ticketId) || null,
    raceDate: text(athlete.raceDate) || null,
    email: text(athlete.email) || null,
  });
}

function bibFromWatchlistId(value: unknown): string {
  const raw = text(value);
  const tagged = raw.match(/(?:^|:)bib:([^:]+)/i)?.[1];
  if (tagged) return text(tagged);
  const legacyRaceBib = raw.match(/(?:^|:)race:[^:]+:[^:]+:(\d+)$/i)?.[1];
  return text(legacyRaceBib);
}

function isPlaceholderBib(value: unknown): boolean {
  const candidate = text(value);
  return !candidate || /^(?:participant|athlete|timing):/i.test(candidate);
}

function eventFromWatchlistId(value: unknown): string {
  const raw = text(value);
  const marker = raw.toLowerCase().lastIndexOf(":bib:");
  return marker > 0 ? raw.slice(0, marker) : "";
}

function usableWatchlistName(value: unknown, compositeId: string): string {
  const candidate = text(value);
  if (!candidate || candidate === compositeId) return "";
  if (/^bib\s+.+:bib:/i.test(candidate)) return "";
  return candidate;
}

function trackedAthleteFromSubscription(value: unknown): TrackedAthlete | null {
  if (!value || typeof value !== "object") return null;
  const outer = value as Record<string, unknown>;
  const nested =
    outer.athlete && typeof outer.athlete === "object"
      ? (outer.athlete as Record<string, unknown>)
      : {};
  const row = { ...outer, ...nested };
  const compositeId = text(outer.id);
  const rawBib = text(row.bib) || text(row.bibNumber);
  const parsedBib =
    bibFromWatchlistId(rawBib) ||
    (!isPlaceholderBib(rawBib) ? rawBib : "") ||
    bibFromWatchlistId(row.athleteId) ||
    bibFromWatchlistId(compositeId);
  const rawAthleteId = text(row.athleteId);
  const genericAthleteId = bibFromWatchlistId(rawAthleteId)
    ? `bib:${bibFromWatchlistId(rawAthleteId)}`
    : rawAthleteId;
  const taggedBibId =
    parsedBib && /(?:^|:)bib:/i.test(compositeId) ? `bib:${parsedBib}` : "";
  const id =
    (parsedBib ? `bib:${parsedBib}` : "") ||
    (text(nested.id) && text(nested.id) !== compositeId
      ? text(nested.id)
      : "") ||
    genericAthleteId ||
    text(row.participantUuid) ||
    text(row.providerAthleteUuid) ||
    text(row.providerUuid) ||
    taggedBibId ||
    parsedBib;
  if (!id) return null;
  const bib = parsedBib || id;
  const name =
    usableWatchlistName(row.name, compositeId) ||
    usableWatchlistName(row.displayName, compositeId) ||
    usableWatchlistName(row.fullName, compositeId) ||
    usableWatchlistName(outer.label, compositeId) ||
    `Bib ${bib}`;
  const athleteUid = text(row.athleteUid);
  return {
    id,
    // Keep the opaque account-watchlist key. It can differ from the current
    // roster identity after a provider import or bib normalization.
    watchlistItemId: compositeId || undefined,
    bib,
    name,
    eventId:
      text(row.eventId) || eventFromWatchlistId(compositeId) || undefined,
    category:
      text(row.contestName) ||
      text(row.providerContestName) ||
      text(row.contest) ||
      text(row.ticketName) ||
      text(row.category) ||
      undefined,
    ageGroup:
      text(row.ageGroup) ||
      text(row.ageGroupName) ||
      text(row.categoryName) ||
      undefined,
    club: text(row.club) || text(row.clubName) || undefined,
    photoUrl:
      text(row.profilePhotoUrl) ||
      text(row.photoUrl) ||
      text(row.photoURL) ||
      text(row.avatarUrl) ||
      text(row.displayPhoto) ||
      undefined,
    email: text(row.email) || undefined,
    participantUuid: text(row.participantUuid) || undefined,
    providerUuid: text(row.providerUuid) || undefined,
    providerAthleteUuid: text(row.providerAthleteUuid) || undefined,
    providerTimingUuid: text(row.providerTimingUuid) || undefined,
    providerRecordId: text(row.providerRecordId) || undefined,
    // A generic `athleteId` may be `bib:1001`; it is not a Firebase UID.
    athleteUid: athleteUid || undefined,
    bookingId: text(row.bookingId) || undefined,
    contestId: text(row.contestId) || undefined,
    contestUuid: text(row.contestUuid) || undefined,
    providerContestUuid: text(row.providerContestUuid) || undefined,
    providerContestId: text(row.providerContestId) || undefined,
    ticketId: text(row.ticketId) || undefined,
    raceDate: text(row.raceDate) || undefined,
    trackingVisibility: text(row.trackingVisibility) || undefined,
    liveTrackingPrivacy: text(row.liveTrackingPrivacy) || undefined,
    privacy: text(row.privacy) || undefined,
    liveTrackingVisibility: text(row.liveTrackingVisibility) || undefined,
    searchVisible: row.searchVisible !== false,
    mapVisible: row.mapVisible !== false,
    modalVisible: row.modalVisible !== false,
    viewerCanSeeIdentity: row.viewerCanSeeIdentity === true,
    privacyMasked: row.privacyMasked === true,
    anonymous:
      row.viewerCanSeeIdentity === true ? false : row.anonymous === true,
  };
}

async function unsubscribeTrackedAthlete(
  athlete: Partial<ResolvedAthlete>,
  fallbackEventId?: string,
) {
  const athleteId = resolveAthleteId(athlete);
  const eventId = text(athlete.eventId) || fallbackEventId;
  if (!athleteId || !eventId) return;
  await repositories.trackingSubscriptions.unsubscribe({
    eventId,
    athleteId,
    watchlistItemId: text(athlete.watchlistItemId) || undefined,
  });
}

/** Account watchlist with an optimistic Secure Store cache for offline use. */
export function useWatchlist(
  eventId?: string,
  roster: Record<string, unknown>[] = [],
  syncWhileVisible = false,
) {
  const athletes = useWatchlistStore((s) => s.athletes);
  const hydrated = useWatchlistStore((s) => s.hydrated);
  const hydrate = useWatchlistStore((s) => s.hydrate);
  const replaceAthletes = useWatchlistStore((s) => s.replaceAthletes);
  const storeToggle = useWatchlistStore((s) => s.toggle);
  const storeAddAthlete = useWatchlistStore((s) => s.addAthlete);
  const storeIsWatched = useWatchlistStore((s) => s.isWatched);
  const isAuthenticated = useSession((s) => s.status === "authenticated");
  const userId = useSession((s) => s.user?.uid);
  const pendingAddIdsRef = useRef(new Set<string>());
  const pendingRemoveIdsRef = useRef(new Set<string>());
  const accountWatchlistQuery = useQuery({
    queryKey: ["tracking", "account-watchlist", userId],
    queryFn: () => repositories.trackingSubscriptions.list(),
    enabled: isAuthenticated && Boolean(userId),
    staleTime: 0,
    refetchInterval: syncWhileVisible ? 5_000 : false,
    refetchIntervalInBackground: false,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });
  const refetchAccountWatchlist = accountWatchlistQuery.refetch;
  const resolvedAthletes = useMemo(() => {
    if (!eventId) return athletes;
    const eventAthletes = athletes.filter(
      (athlete) => text(athlete.eventId) === eventId,
    );
    if (roster.length === 0)
      return dedupeResolvedAthletes(eventAthletes, eventId);

    const eventIds = eventAthletes.flatMap((athlete) =>
      athleteIdentityValues(athlete).flatMap((value) => {
        const parsedBib = bibFromWatchlistId(value);
        return parsedBib ? [value, parsedBib] : [value];
      }),
    );
    const rosterAthletes = resolveFromRoster(eventId, eventIds, roster);
    // Once the event roster is available, only reconciled canonical athletes
    // may be rendered. Persisted subscription rows are identity hints, not a
    // second athlete source; appending them caused duplicate and "Unmapped"
    // cards when historical IDs survived a participant rebuild.
    return dedupeResolvedAthletes(rosterAthletes, eventId);
  }, [athletes, eventId, roster]);

  useEffect(() => {
    void hydrate(userId ?? null);
  }, [hydrate, userId]);

  useEffect(() => {
    if (!hydrated || !Array.isArray(accountWatchlistQuery.data)) return;
    const serverAthletes = accountWatchlistQuery.data
      .map(trackedAthleteFromSubscription)
      .filter((athlete): athlete is TrackedAthlete => Boolean(athlete))
      .filter((athlete) => !pendingRemoveIdsRef.current.has(resolveAthleteId(athlete)));
    const optimisticAdds = useWatchlistStore.getState().athletes.filter((athlete) =>
      pendingAddIdsRef.current.has(resolveAthleteId(athlete)),
    );
    replaceAthletes([...optimisticAdds, ...serverAthletes]);
  }, [accountWatchlistQuery.data, hydrated, replaceAthletes]);

  useEffect(() => {
    if (syncWhileVisible && isAuthenticated) {
      void refetchAccountWatchlist();
    }
  }, [isAuthenticated, refetchAccountWatchlist, syncWhileVisible]);

  const reconcileAfterMutation = useCallback(
    async (mutation: Promise<void>) => {
      try {
        await mutation;
        if (isAuthenticated) await refetchAccountWatchlist();
        return true;
      } catch (error) {
        console.warn("[watchlist] synchronization failed", error);
        Alert.alert(
          "Watchlist synchronization error",
          "Your selection is saved on this device. Notification synchronization will retry when the connection is available.",
        );
        return false;
      }
    },
    [isAuthenticated, refetchAccountWatchlist],
  );

  const addAthlete = useCallback(
    (athlete: ResolvedAthlete) => {
      const wasEmpty = useWatchlistStore.getState().athletes.length === 0;
      const resolvedId = resolveAthleteId(athlete) || text(athlete.bib);
      if (!resolvedId) return;
      const localAthlete: ResolvedAthlete = {
        ...athlete,
        id: resolvedId,
        bib: text(athlete.bib) || resolvedId,
        name: text(athlete.name) || `Bib ${text(athlete.bib) || resolvedId}`,
        eventId: text(athlete.eventId) || eventId,
        providerUuid:
          text(athlete.providerUuid) ||
          text(athlete.participantUuid) ||
          text(athlete.providerTimingUuid) ||
          undefined,
      };
      storeAddAthlete(localAthlete);
      pendingRemoveIdsRef.current.delete(resolvedId);
      pendingAddIdsRef.current.add(resolvedId);
      void reconcileAfterMutation(subscribeTrackedAthlete(localAthlete, eventId)).then((synchronized) => {
        if (synchronized) pendingAddIdsRef.current.delete(resolvedId);
      });
      if (wasEmpty) void promptTrackedAthleteNotifications();
    },
    [eventId, isAuthenticated, reconcileAfterMutation, storeAddAthlete],
  );

  const toggle = useCallback(
    (id: string) => {
      const existing = useWatchlistStore
        .getState()
        .athletes.find((athlete) =>
          matchesResolvedAthleteId(athlete, id, eventId),
        );
      if (!existing) return;
      const resolvedId = resolveAthleteId(existing) || id;
      pendingAddIdsRef.current.delete(resolvedId);
      pendingRemoveIdsRef.current.add(resolvedId);
      storeToggle(id, eventId);
      void reconcileAfterMutation(unsubscribeTrackedAthlete(existing, eventId)).then((synchronized) => {
        if (synchronized) pendingRemoveIdsRef.current.delete(resolvedId);
      });
    },
    [eventId, isAuthenticated, reconcileAfterMutation, storeToggle],
  );

  return {
    ids: resolvedAthletes.map((athlete) => athlete.id),
    athletes: resolvedAthletes as ResolvedAthlete[],
    hydrated,
    toggle,
    addAthlete,
    isWatched: (id: string) => storeIsWatched(id, eventId),
  };
}
