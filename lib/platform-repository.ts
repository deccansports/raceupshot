import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { KVNamespace } from "@cloudflare/workers-types";
import type {
  Announcement,
  AthletePrivacyPreference,
  AthleteVisibility,
  EventPlatformSettings,
  FeibotIntegrationConfig,
  LiveParticipant,
  LiveSplit,
  LiveTrackingSettings,
  MobileEventSettings,
  PublicEvent,
  EventCourseView,
} from "@/packages/contracts/src";
import { resolveMobileEventSection } from "./mobile-event-section";
import { applyPublicAthletePrivacy, resolveAthleteVisibility } from "@/packages/privacy-core/src";
import {
  normalizeEventStatus,
  normalizeFeibotParticipant,
  normalizeRaceStatus,
  normalizeVisibility,
} from "@/packages/timing-core/src";
import { getAthleteResult, getEventBySlug, getEvents, getResults } from "./raceupshot-repository";
import { getPublicEventCourseMaps } from "./course-maps";
import { canonicalManifestUpdatedAt, getCanonicalLiveEvent, getCanonicalLiveParticipant, getCanonicalParticipantIndex, searchCanonicalLiveParticipants } from "./canonical-live-tracking";
import { ensureFeibotLiveSyncSchedule } from "./feibot-live-sync-scheduler";
import type { Athlete, RaceEvent } from "./types";
import { withTransientKvRetry } from "./kv-retry";
import { mapWithConcurrency } from "./map-with-concurrency";
import { resultPace } from "./result-pace";

const PREFIX = "raceupshot";
const DEFAULT_CACHE_SECONDS = 10;
const VISIBILITY_OVERRIDE_SUFFIX = "visibility-overrides";
type JsonRecord = Record<string, unknown>;

export interface PlatformRead<T> {
  data: T;
  lastUpdatedAt: string | null;
  source: "raceupshot" | "timing-provider" | "published-results";
  provider?: "FEIBOT" | "MANUAL" | "RACE_UPSHOT";
  isStale: boolean;
  cacheSeconds: number;
}

async function getKv(): Promise<KVNamespace> {
  const { env } = await getCloudflareContext({ async: true });
  if (!env.RACEUPSHOT) throw new Error("RACEUPSHOT KV binding is unavailable.");
  return withTransientKvRetry(env.RACEUPSHOT);
}

function defaultLiveSettings(event: RaceEvent): LiveTrackingSettings {
  const publiclyTrackable = event.status === "live";
  return {
    liveTrackingEnabled: publiclyTrackable,
    publicLiveTrackingEnabled: publiclyTrackable,
    loginOnlyTracking: false,
    athleteSearchEnabled: true,
    leaderboardEnabled: true,
    liveMapEnabled: false,
    splitsEnabled: true,
    estimatedPositionEnabled: false,
    watchlistEnabled: true,
    sharingEnabled: true,
    anonymousTrackingAllowed: true,
    privateTrackingAllowed: true,
    defaultAthleteVisibility: "PUBLIC",
    forceVisibility: null,
    resultsVisibleDuringRace: true,
    provisionalLeaderboard: true,
    liveTrackingStartAt: null,
    liveTrackingEndAt: null,
  };
}

function defaultMobileSettings(event: RaceEvent): MobileEventSettings {
  return {
    mobilePublished: event.status !== "draft" && event.status !== "archived",
    mobileFeatured: false,
    mobileSection: "AUTO",
    athleteSearchEnabled: true,
    leaderboardEnabled: true,
    courseMapEnabled: false,
    watchlistEnabled: true,
    notificationsEnabled: false,
    resultsEnabled: true,
    certificatesEnabled: true,
    announcementsEnabled: true,
    displayOrder: 0,
    deepLinkSlug: event.slug,
  };
}

export function defaultEventPlatformSettings(event: RaceEvent): EventPlatformSettings {
  return {
    eventId: event.id,
    live: defaultLiveSettings(event),
    mobile: defaultMobileSettings(event),
    timingIntegration: null,
    updatedAt: event.dateIso || new Date(0).toISOString(),
  };
}

function mergePlatformSettings(event: RaceEvent, stored: Partial<EventPlatformSettings> | null): EventPlatformSettings {
  const defaults = defaultEventPlatformSettings(event);
  return {
    ...defaults,
    ...stored,
    eventId: event.id,
    live: { ...defaults.live, ...(stored?.live ?? {}) },
    mobile: { ...defaults.mobile, ...(stored?.mobile ?? {}) },
    timingIntegration: stored?.timingIntegration
      ? {
          ...stored.timingIntegration,
          timingResultSource: stored.timingIntegration.timingResultSource ?? "FEIBOT_PROCESSED",
          resultTimeMode: stored.timingIntegration.resultTimeMode ?? "CHIP",
          passageGapMs: stored.timingIntegration.passageGapMs ?? 5_000,
          readerDetectionTimeoutMs: stored.timingIntegration.readerDetectionTimeoutMs ?? {},
        }
      : null,
  };
}

export async function getEventPlatformSettings(eventIdOrSlug: string): Promise<EventPlatformSettings | null> {
  const event = await getEventBySlug(eventIdOrSlug, { includeUnpublished: true });
  if (!event) return null;
  const kv = await getKv();
  const stored = await kv.get<Partial<EventPlatformSettings>>(`${PREFIX}:event:${event.id}:platform-settings`, "json");
  return mergePlatformSettings(event, stored);
}

export async function saveEventPlatformSettings(
  eventId: string,
  input: Pick<EventPlatformSettings, "live" | "mobile" | "timingIntegration">,
): Promise<EventPlatformSettings> {
  const event = await getEventBySlug(eventId, { includeUnpublished: true });
  if (!event) throw new Error("Event not found.");
  const kv = await getKv();
  const saved: EventPlatformSettings = {
    eventId: event.id,
    live: input.live,
    mobile: input.mobile,
    timingIntegration: input.timingIntegration ? {
      ...input.timingIntegration,
      accountReference: input.timingIntegration.accountReference.trim(),
      updatedAt: new Date().toISOString(),
    } : null,
    updatedAt: new Date().toISOString(),
  };
  const auditId = crypto.randomUUID();
  await Promise.all([
    kv.put(`${PREFIX}:event:${event.id}:platform-settings`, JSON.stringify(saved)),
    kv.put(`${PREFIX}:timing:audit:${auditId}`, JSON.stringify({
      id: auditId,
      action: "EVENT_PLATFORM_SETTINGS_UPDATED",
      entity: event.name,
      eventId: event.id,
      actor: "Race Upshot admin",
      createdAt: saved.updatedAt,
    })),
  ]);
  const auditIndex = (await kv.get<string[]>(`${PREFIX}:timing:audit:index`, "json")) ?? [];
  if (!auditIndex.includes(auditId)) {
    await kv.put(`${PREFIX}:timing:audit:index`, JSON.stringify([...auditIndex, auditId]));
  }
  return saved;
}

export async function getPlatformEvents(options: { includeUnpublished?: boolean; mobileOnly?: boolean } = {}): Promise<PublicEvent[]> {
  const events = await getEvents({ includeUnpublished: options.includeUnpublished });
  const platformEvents = await Promise.all(events.map(async (event) => {
    const settings = await getEventPlatformSettings(event.id) ?? defaultEventPlatformSettings(event);
    const lifecycleStatus = normalizeEventStatus(event.status);
    const section = resolveMobileEventSection(lifecycleStatus, settings.mobile.mobileSection, event.dateIso, event.endsAt);
    return {
      eventId: event.id,
      slug: event.slug,
      name: event.name,
      sport: event.sport,
      lifecycleStatus,
      section,
      startsAt: event.dateIso,
      endsAt: event.endsAt,
      dateLabel: event.date,
      startTime: event.startTime,
      city: event.city,
      venue: event.venue,
      location: event.location,
      description: event.description,
      organizer: event.organizer,
      contactEmail: event.contactEmail,
      contactPhone: event.contactPhone,
      websiteUrl: event.websiteUrl,
      latitude: event.latitude,
      longitude: event.longitude,
      logoUrl: event.logoUrl,
      bannerUrl: event.bannerUrl,
      registrationUrl: event.registrationUrl,
      knowMoreUrl: event.knowMoreUrl,
      broadcastUrl: event.broadcastUrl,
      rulesUrl: event.rulesHtml ? `/events/${encodeURIComponent(event.slug)}/rules` : event.rulesUrl,
      athleteGuidebookUrl: event.athleteGuidebookUrl,
      contests: event.categories,
      ticketDefinitions: event.ticketDefinitions,
      participantCount: event.participants,
      hasResults: event.hasResults,
      liveSettings: settings.live,
      mobileSettings: settings.mobile,
    } satisfies PublicEvent;
  }));
  return platformEvents
    .filter((event) => !options.mobileOnly || event.mobileSettings.mobilePublished)
    .sort((a, b) => a.mobileSettings.displayOrder - b.mobileSettings.displayOrder || Date.parse(b.startsAt) - Date.parse(a.startsAt));
}

export async function getPlatformEvent(eventIdOrSlug: string, includeUnpublished = false): Promise<PublicEvent | null> {
  const events = await getPlatformEvents({ includeUnpublished });
  return events.find((event) => event.eventId === eventIdOrSlug || event.slug === eventIdOrSlug) ?? null;
}

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
}

function stringValue(record: JsonRecord, ...keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return "";
}

interface ParticipantPrivacyContext {
  uid: string;
  email: string;
  preference?: AthletePrivacyPreference;
}

export interface ParticipantViewer {
  revealAll?: boolean;
  athleteUid?: string;
  athleteEmail?: string | null;
}

async function privacyContextFromIdentity(
  kv: KVNamespace,
  uidInput: string | undefined,
  emailInput: string | undefined,
): Promise<ParticipantPrivacyContext> {
  let uid = uidInput?.trim() ?? "";
  const email = emailInput?.trim().toLowerCase() ?? "";
  if (!uid && email) {
    uid = await kv.get(`raceupshot:athlete-profile-email:${email}`) || "";
  }
  if (!uid) return { uid: "", email };
  const profile = await kv.get<{ trackingVisibility?: "PUBLIC" | "ANONYMOUS" | "PRIVATE" }>(
    `raceupshot:athlete-profile:${uid}`,
    "json",
  );
  if (!profile?.trackingVisibility) return { uid, email };
  const trackingVisibility = profile.trackingVisibility === "PUBLIC" ? "PUBLIC" : "ANONYMOUS";
  const anonymous = trackingVisibility === "ANONYMOUS";
  return {
    uid,
    email,
    preference: {
      liveTrackingVisibility: trackingVisibility,
      showProfilePhoto: !anonymous,
      showCountry: !anonymous,
      showClub: !anonymous,
      showAgeGroup: true,
      showResultAfterFinish: true,
      allowResultSharing: true,
      allowWatchlist: true,
    },
  };
}

async function privacyContextForParticipant(kv: KVNamespace, raw: JsonRecord, participant: LiveParticipant): Promise<ParticipantPrivacyContext> {
  return privacyContextFromIdentity(
    kv,
    participant.athleteUid || stringValue(raw, "athleteUid", "athlete_uid", "userUid", "user_uid"),
    stringValue(raw, "email", "emailAddress", "email_address", "participantEmail"),
  );
}

interface AthletePrivacyLookup {
  byUid: Map<string, ParticipantPrivacyContext>;
  byEmail: Map<string, ParticipantPrivacyContext>;
}

function indexedUserId(value: unknown): string {
  if (typeof value === "string") return value.trim();
  const row = asRecord(value);
  return row ? stringValue(row, "uid", "userId", "id") : "";
}

async function loadAthletePrivacyLookup(kv: KVNamespace): Promise<AthletePrivacyLookup> {
  const storedIndex = await kv.get<unknown[]>(`${PREFIX}:users:index`, "json");
  const userIds = [...new Set((Array.isArray(storedIndex) ? storedIndex : []).map(indexedUserId).filter(Boolean))];
  const profiles = await mapWithConcurrency(userIds, 8, (uid) => kv.get<{
    uid?: string;
    email?: string | null;
    trackingVisibility?: "PUBLIC" | "ANONYMOUS" | "PRIVATE";
  }>(`${PREFIX}:athlete-profile:${uid}`, "json"));
  const lookup: AthletePrivacyLookup = { byUid: new Map(), byEmail: new Map() };
  profiles.forEach((profile, index) => {
    if (!profile) return;
    const uid = profile.uid?.trim() || userIds[index];
    const email = profile.email?.trim().toLowerCase() || "";
    const context: ParticipantPrivacyContext = {
      uid,
      email,
      ...(profile.trackingVisibility ? {
        preference: {
          liveTrackingVisibility: profile.trackingVisibility === "PUBLIC" ? "PUBLIC" as const : "ANONYMOUS" as const,
          showProfilePhoto: profile.trackingVisibility === "PUBLIC",
          showCountry: profile.trackingVisibility === "PUBLIC",
          showClub: profile.trackingVisibility === "PUBLIC",
          showAgeGroup: true,
          showResultAfterFinish: true,
          allowResultSharing: true,
          allowWatchlist: true,
        },
      } : {}),
    };
    if (uid) lookup.byUid.set(uid, context);
    if (email) lookup.byEmail.set(email, context);
  });
  return lookup;
}

function privacyContextForParticipantFromLookup(
  lookup: AthletePrivacyLookup,
  raw: JsonRecord | null,
  participant: LiveParticipant,
  accountUid?: string,
  accountEmail?: string,
): ParticipantPrivacyContext {
  const uid = (accountUid || participant.athleteUid || (raw ? stringValue(raw, "athleteUid", "athlete_uid", "userUid", "user_uid") : "")).trim();
  const email = (accountEmail || (raw ? stringValue(raw, "email", "emailAddress", "email_address", "participantEmail") : "")).trim().toLowerCase();
  return (uid ? lookup.byUid.get(uid) : undefined)
    ?? (email ? lookup.byEmail.get(email) : undefined)
    ?? { uid, email };
}

function viewerOwnsParticipant(viewer: ParticipantViewer | undefined, context: ParticipantPrivacyContext): boolean {
  if (!viewer) return false;
  if (viewer.revealAll) return true;
  if (viewer.athleteUid && context.uid && viewer.athleteUid === context.uid) return true;
  return Boolean(
    viewer.athleteEmail
    && context.email
    && viewer.athleteEmail.trim().toLowerCase() === context.email,
  );
}

function numberValue(record: JsonRecord, ...keys: string[]): number | undefined {
  const raw = stringValue(record, ...keys);
  if (!raw) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeLiveSplits(value: unknown): LiveSplit[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index) => {
    const split = asRecord(item);
    if (!split) return [];
    return [{
      splitId: stringValue(split, "splitId", "id", "code") || `split-${index + 1}`,
      name: stringValue(split, "name", "label", "timingPoint") || `Split ${index + 1}`,
      splitTime: stringValue(split, "splitTime", "time", "segmentTime"),
      cumulativeTime: stringValue(split, "cumulativeTime", "cumulative") || undefined,
      distanceKm: numberValue(split, "distanceKm", "distance"),
      paceOrSpeed: stringValue(split, "paceOrSpeed", "pace", "speed") || undefined,
      rankAtSplit: numberValue(split, "rankAtSplit", "rank"),
      status: stringValue(split, "status") || undefined,
      timestamp: stringValue(split, "timestamp", "recordedAt") || undefined,
      readerTimestamp: stringValue(split, "readerTimestamp") || undefined,
      gunStartTimestamp: stringValue(split, "gunStartTimestamp") || undefined,
      chipStartTimestamp: stringValue(split, "chipStartTimestamp") || undefined,
      gunTimeMs: numberValue(split, "gunTimeMs"),
      chipTimeMs: numberValue(split, "chipTimeMs"),
      sectionTimeMs: numberValue(split, "sectionTimeMs"),
      officialTimeMs: numberValue(split, "officialTimeMs"),
      source: (["AUTO", "FIXED", "MANUAL", "FEIBOT_PROCESSED"] as const).find((source) => source === stringValue(split, "source")) || undefined,
    }];
  });
}

export function normalizeLiveRecord(raw: JsonRecord, eventId: string): LiveParticipant {
  const participant = normalizeFeibotParticipant(raw, {
    eventId,
    contestId: stringValue(raw, "contestId", "categoryId") || undefined,
  });
  return {
    ...participant,
    splits: normalizeLiveSplits(raw.splits),
    pace: stringValue(raw, "pace", "averagePace", "avgPace", "paceOrSpeed", "speed") || undefined,
    photoUrl: stringValue(raw, "photoUrl", "profilePhotoUrl") || undefined,
    cumulativeTime: stringValue(raw, "cumulativeTime") || undefined,
    resultStatus: stringValue(raw, "resultStatus") || undefined,
    certificateUrl: stringValue(raw, "certificateUrl") || undefined,
  };
}

function athleteToLiveParticipant(athlete: Athlete): LiveParticipant {
  const initials = athlete.name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "RU";
  return {
    eventId: athlete.eventId,
    participantUid: athlete.id,
    athleteUid: athlete.athleteUid,
    bib: athlete.bib,
    displayName: athlete.name,
    fullName: athlete.name,
    initials,
    contestName: athlete.category,
    gender: athlete.gender,
    ageGroup: athlete.ageGroup,
    country: athlete.country,
    club: athlete.club,
    visibility: "PUBLIC",
    raceStatus: normalizeRaceStatus(athlete.status),
    elapsedTime: athlete.finishTime,
    pace: athlete.pace || undefined,
    latestTimingPoint: athlete.lastSplit,
    overallRank: athlete.rank || undefined,
    genderRank: athlete.genderRank || undefined,
    ageGroupRank: athlete.ageRank || undefined,
    splits: athlete.splits.map((split, index) => ({
      splitId: `split-${index + 1}`,
      name: split.label,
      splitTime: split.time,
    })),
    resultStatus: athlete.status,
    certificateUrl: athlete.certificateUrl,
    timingSource: "published-results",
  };
}

export function liveParticipantToAthlete(participant: LiveParticipant, event: RaceEvent): Athlete {
  return {
    id: participant.participantUid,
    athleteUid: participant.athleteUid,
    name: participant.visibility === "ANONYMOUS" ? "Anonymous Athlete" : participant.displayName,
    bib: participant.visibility === "ANONYMOUS" ? "" : participant.bib,
    gender: participant.visibility === "ANONYMOUS" ? "" : participant.gender || "",
    ageGroup: participant.ageGroup || "",
    club: participant.visibility === "ANONYMOUS" ? "" : participant.club || "",
    city: "",
    country: participant.visibility === "ANONYMOUS" ? "" : participant.country || "",
    category: participant.contestName,
    rank: participant.overallRank || 0,
    genderRank: participant.genderRank || 0,
    ageRank: participant.ageGroupRank || 0,
    finishTime: participant.elapsedTime || participant.cumulativeTime || "",
    pace: resultPace(participant),
    status: participant.raceStatus.replaceAll("_", " "),
    lastSplit: participant.latestTimingPoint || participant.splits.at(-1)?.name || "",
    eventId: event.id,
    eventSlug: event.slug,
    eventName: event.name,
    splits: participant.splits.map((split) => ({ label: split.name, time: split.splitTime })),
    certificateUrl: participant.visibility === "ANONYMOUS" ? undefined : participant.certificateUrl,
    visibility: participant.visibility,
  };
}

function unpackParticipants(payload: unknown): JsonRecord[] {
  if (Array.isArray(payload)) return payload.map(asRecord).filter((row): row is JsonRecord => Boolean(row));
  const record = asRecord(payload);
  if (!record) return [];
  for (const key of ["participants", "athletes", "rows", "data"]) {
    if (Array.isArray(record[key])) return (record[key] as unknown[]).map(asRecord).filter((row): row is JsonRecord => Boolean(row));
  }
  return [];
}

function stale(lastUpdatedAt: string | null, thresholdSeconds = 60): boolean {
  if (!lastUpdatedAt) return true;
  const parsed = Date.parse(lastUpdatedAt);
  return Number.isNaN(parsed) || Date.now() - parsed > thresholdSeconds * 1000;
}

async function getPublicParticipants(
  eventIdOrSlug: string,
  purpose: "live" | "results",
  viewer?: ParticipantViewer,
  participantUidOrBib?: string,
  resolvedEvent?: PublicEvent,
): Promise<PlatformRead<LiveParticipant[]> | null> {
  const event = resolvedEvent ?? await getPlatformEvent(eventIdOrSlug);
  if (!event) return null;
  const kv = await getKv();
  const settings = await getEventPlatformSettings(event.eventId) ?? defaultEventPlatformSettings({
    id: event.eventId,
    slug: event.slug,
    name: event.name,
    date: event.dateLabel,
    dateIso: event.startsAt,
    location: event.location,
    city: event.city,
    venue: event.venue,
    sport: event.sport,
    status: event.lifecycleStatus === "RESULTS_OFFICIAL"
      ? "official"
      : event.lifecycleStatus === "RESULTS_PROVISIONAL"
        ? "provisional"
        : event.lifecycleStatus === "COMPLETED"
          ? "completed"
          : event.lifecycleStatus.toLowerCase() as RaceEvent["status"],
    categories: event.contests,
    participants: event.participantCount,
    accent: "",
    shortCode: "",
    description: event.description,
    hasResults: event.hasResults,
  });
  // Resolve an exact canonical athlete before touching the legacy event-wide
  // payload. Live tracker polling should read one versioned participant record,
  // never deserialize the full roster once canonical data is available.
  const canonicalDetail = purpose === "live" && participantUidOrBib
    ? await getCanonicalLiveParticipant(event.eventId, participantUidOrBib)
    : null;
  const canonical = purpose === "live"
    ? canonicalDetail
      ? { manifest: canonicalDetail.manifest, participants: [canonicalDetail.participant], leaderboard: [] }
      : await getCanonicalLiveEvent(event.eventId)
    : null;
  const [payload, updatedRaw, visibilityOverrides] = await Promise.all([
    canonical
      ? Promise.resolve(null)
      : kv.get<unknown>(`${PREFIX}:live:event:${event.eventId}:participants`, "json"),
    kv.get(`${PREFIX}:live:event:${event.eventId}:updated`),
    kv.get<Record<string, AthleteVisibility>>(
      `${PREFIX}:live:event:${event.eventId}:${VISIBILITY_OVERRIDE_SUFFIX}`,
      "json",
    ),
  ]);
  // Schedule ownership is established by canonical publication and bulk live
  // entry points. Reconfiguring the Durable Object on every one-second athlete
  // poll adds avoidable latency to the hottest mobile request.
  if (purpose === "live" && canonical && !participantUidOrBib) {
    await ensureFeibotLiveSyncSchedule(event.eventId, true);
  }
  const rawRows = unpackParticipants(payload);
  let participants: Array<{
    participant: LiveParticipant;
    raw: JsonRecord | null;
    accountUid?: string;
    accountEmail?: string;
  }>;
  let source: PlatformRead<LiveParticipant[]>["source"];
  let lastUpdatedAt = updatedRaw;
  if (canonical) {
    participants = canonical.participants.map((participant) => ({ participant, raw: null }));
    source = "timing-provider";
    lastUpdatedAt = canonicalManifestUpdatedAt(canonical.manifest);
  } else if (rawRows.length) {
    participants = rawRows.flatMap((row) => {
      try {
        return [{ participant: normalizeLiveRecord(row, event.eventId), raw: row }];
      } catch {
        return [];
      }
    });
    source = "timing-provider";
  } else {
    const results = await getResults(event.slug);
    participants = results.athletes.map((athlete) => ({
      participant: athleteToLiveParticipant(athlete),
      raw: null,
      accountUid: athlete.athleteUid,
      accountEmail: athlete.email,
    }));
    source = "published-results";
    lastUpdatedAt = null;
  }
  const privacySettings = purpose === "results"
    ? { ...settings.live, liveTrackingEnabled: true, publicLiveTrackingEnabled: true }
    : settings.live;
  // Detail reads must not resolve privacy/profile KV data for the complete
  // field. A selected athlete is polled every second during a race, so filter
  // by its canonical UID or bib before the per-athlete privacy lookup.
  const selectedParticipants = participantUidOrBib
    ? participants.filter(({ participant }) =>
        participant.participantUid === participantUidOrBib ||
        participant.bib === participantUidOrBib,
      )
    : participants;
  // Bulk result lists must not perform one or two KV profile reads for every
  // imported athlete. Load the small registered-user index once, then resolve
  // participant privacy in memory. Targeted reads keep the direct lookup path.
  const privacyLookup = selectedParticipants.length > 1
    ? await loadAthletePrivacyLookup(kv)
    : null;
  const publicParticipants = (await Promise.all(selectedParticipants.map(async ({
    participant,
    raw,
    accountUid,
    accountEmail,
  }) => {
    const rawVisibility = participant.visibility ?? normalizeVisibility("PUBLIC");
    const context = privacyLookup
      ? privacyContextForParticipantFromLookup(privacyLookup, raw, participant, accountUid, accountEmail)
      : raw
        ? await privacyContextForParticipant(kv, raw, participant)
        : await privacyContextFromIdentity(kv, accountUid || participant.athleteUid, accountEmail);
    const preference = context.preference;
    const adminOverride = visibilityOverrides?.[participant.participantUid] ?? null;
    if (viewerOwnsParticipant(viewer, context)) {
      return {
        ...participant,
        visibility: resolveAthleteVisibility({
          eventSettings: privacySettings,
          athletePreference: preference?.liveTrackingVisibility ?? rawVisibility,
          adminOverride,
        }),
      };
    }
    return applyPublicAthletePrivacy({ ...participant, visibility: rawVisibility }, privacySettings, preference, adminOverride);
  }))).filter((participant): participant is LiveParticipant => Boolean(participant));
  return {
    data: publicParticipants,
    lastUpdatedAt,
    source,
    provider: source === "timing-provider" ? "FEIBOT" : "RACE_UPSHOT",
    isStale: stale(lastUpdatedAt),
    cacheSeconds: DEFAULT_CACHE_SECONDS,
  };
}

export function getPublicLiveParticipants(eventIdOrSlug: string, viewer?: ParticipantViewer): Promise<PlatformRead<LiveParticipant[]> | null> {
  return getPublicParticipants(eventIdOrSlug, "live", viewer);
}

export async function searchPublicLiveParticipants(eventIdOrSlug: string, query: string, viewer?: ParticipantViewer): Promise<PlatformRead<LiveParticipant[]> | null> {
  const event = await getPlatformEvent(eventIdOrSlug);
  if (!event) return null;
  const canonical = await searchCanonicalLiveParticipants(event.eventId, query, 50);
  if (!canonical) return null;
  await ensureFeibotLiveSyncSchedule(event.eventId, true);
  const kv = await getKv();
  const settings = await getEventPlatformSettings(event.eventId) ?? defaultEventPlatformSettings({
    id: event.eventId, slug: event.slug, name: event.name, date: event.dateLabel, dateIso: event.startsAt,
    location: event.location, city: event.city, venue: event.venue, sport: event.sport,
    status: event.lifecycleStatus.toLowerCase() as RaceEvent["status"], categories: event.contests,
    participants: event.participantCount, accent: "", shortCode: "", description: event.description, hasResults: event.hasResults,
  });
  const visibilityOverrides = await kv.get<Record<string, AthleteVisibility>>(`${PREFIX}:live:event:${event.eventId}:${VISIBILITY_OVERRIDE_SUFFIX}`, "json");
  const data = (await Promise.all(canonical.participants.map(async (participant) => {
    const context = await privacyContextFromIdentity(kv, participant.athleteUid, undefined);
    const rawVisibility = participant.visibility ?? normalizeVisibility("PUBLIC");
    const adminOverride = visibilityOverrides?.[participant.participantUid] ?? null;
    if (viewerOwnsParticipant(viewer, context)) return { ...participant, visibility: resolveAthleteVisibility({ eventSettings: settings.live, athletePreference: context.preference?.liveTrackingVisibility ?? rawVisibility, adminOverride }) };
    return applyPublicAthletePrivacy({ ...participant, visibility: rawVisibility }, settings.live, context.preference, adminOverride);
  }))).filter((participant): participant is LiveParticipant => Boolean(participant));
  const lastUpdatedAt = canonicalManifestUpdatedAt(canonical.manifest);
  return { data, lastUpdatedAt, source: "timing-provider", provider: "FEIBOT", isStale: stale(lastUpdatedAt), cacheSeconds: 0 };
}

export function getPublicResultParticipants(eventIdOrSlug: string, viewer?: ParticipantViewer): Promise<PlatformRead<LiveParticipant[]> | null> {
  return getPublicParticipants(eventIdOrSlug, "results", viewer);
}

export interface AdminLiveParticipantVisibility {
  participant: LiveParticipant;
  override: AthleteVisibility | null;
}

export async function getAdminParticipantVisibilityOverrides(eventId: string): Promise<Record<string, AthleteVisibility>> {
  const kv = await getKv();
  return (await kv.get<Record<string, AthleteVisibility>>(
    `${PREFIX}:live:event:${eventId}:${VISIBILITY_OVERRIDE_SUFFIX}`,
    "json",
  )) ?? {};
}

export async function getAdminLiveParticipantVisibility(
  eventIdOrSlug: string,
): Promise<{ event: PublicEvent; rows: AdminLiveParticipantVisibility[] } | null> {
  const event = await getPlatformEvent(eventIdOrSlug, true);
  if (!event) return null;
  const kv = await getKv();
  const [payload, overrides] = await Promise.all([
    kv.get<unknown>(`${PREFIX}:live:event:${event.eventId}:participants`, "json"),
    kv.get<Record<string, AthleteVisibility>>(
      `${PREFIX}:live:event:${event.eventId}:${VISIBILITY_OVERRIDE_SUFFIX}`,
      "json",
    ),
  ]);
  const rawRows = unpackParticipants(payload);
  const participants = rawRows.length
    ? rawRows.flatMap((row) => {
      try {
        return [normalizeLiveRecord(row, event.eventId)];
      } catch {
        return [];
      }
    })
    : (await getResults(event.slug)).athletes.map(athleteToLiveParticipant);
  return {
    event,
    rows: participants.map((participant) => ({
      participant,
      override: overrides?.[participant.participantUid] ?? null,
    })),
  };
}

export interface AdminLiveParticipantDetail {
  event: { id: string; slug: string; name: string };
  participant: LiveParticipant;
  identity: {
    email: string | null;
    chipCode: string | null;
    providerEventUuid: string | null;
    providerParticipantUuid: string | null;
    contestUuid: string | null;
    dateOfBirth: string | null;
    waveStartTime: string | null;
    acceptedStartTime: string | null;
    finishTime: string | null;
    currentSplit: string | null;
    statusDetail: string | null;
  };
  canonical: {
    buildVersion: string | null;
    updatedAt: string | null;
    courseVersion: number | null;
    timingVersion: number | null;
    leaderboardVersion: number | null;
  };
}

type AdminHubConfig = {
  start?: { gunStartAt?: string | null };
  legs?: Array<{ id: string; name: string; type: string; distanceKm: number | null }>;
  splits?: Array<{ id: string; name: string; legId: string; order: number; distanceKm: number | null; timingPointId?: string | null }>;
  timingPoints?: Array<{ id: string; type: "START" | "SPLIT" | "FINISH" }>;
};

function durationMilliseconds(value: string | undefined): number | null {
  if (!value) return null;
  const parts = value.trim().split(":").map(Number);
  if (!parts.length || parts.some((part) => !Number.isFinite(part))) return null;
  let seconds = 0;
  for (const part of parts) seconds = seconds * 60 + part;
  return Math.round(seconds * 1_000);
}

function participantOfficialMilliseconds(participant: LiveParticipant): number | null {
  const last = participant.splits.at(-1);
  return last?.officialTimeMs ?? last?.chipTimeMs ?? durationMilliseconds(participant.elapsedTime || participant.cumulativeTime);
}

function timestampFromGunStart(split: LiveSplit | undefined, gunStartAt: string | null): string | null {
  if (!split) return null;
  const explicit = split.readerTimestamp || split.timestamp;
  if (explicit && !Number.isNaN(Date.parse(explicit))) return explicit;
  if (!gunStartAt || split.gunTimeMs === undefined) return null;
  const baseline = Date.parse(gunStartAt);
  return Number.isNaN(baseline) ? null : new Date(baseline + split.gunTimeMs).toISOString();
}

function participantSourceRow(rows: JsonRecord[], participant: LiveParticipant): JsonRecord | null {
  return rows.find((row) => {
    const uid = stringValue(row, "participantUid", "participantUuid", "participant_uuid", "providerParticipantUuid", "uuid", "id");
    const bib = stringValue(row, "bib", "bibNumber", "bib_number");
    return uid === participant.participantUid || (participant.bib && bib === participant.bib);
  }) ?? null;
}

function provisionalRank(
  selected: LiveParticipant,
  participants: LiveParticipant[],
  sourceRows: JsonRecord[],
  group?: "ageGroup" | "gender",
): number | undefined {
  const selectedSource = participantSourceRow(sourceRows, selected);
  const selectedGroup = group === "ageGroup"
    ? selected.ageGroup || (selectedSource ? stringValue(selectedSource, "ageGroup", "age_group", "ageGroupName", "age_group_name") : "")
    : group === "gender"
      ? selected.gender || (selectedSource ? stringValue(selectedSource, "gender", "sex") : "")
      : "";
  if (group && !selectedGroup) return undefined;
  const ranked = participants.flatMap((participant) => {
    const elapsed = participantOfficialMilliseconds(participant);
    if (elapsed === null || elapsed < 0 || participant.raceStatus !== "FINISHED") return [];
    if (group) {
      const source = participantSourceRow(sourceRows, participant);
      const value = group === "ageGroup"
        ? participant.ageGroup || (source ? stringValue(source, "ageGroup", "age_group", "ageGroupName", "age_group_name") : "")
        : participant.gender || (source ? stringValue(source, "gender", "sex") : "");
      if (value.trim().toLowerCase() !== selectedGroup.trim().toLowerCase()) return [];
    }
    return [{ participantUid: participant.participantUid, elapsed }];
  }).sort((left, right) => left.elapsed - right.elapsed || left.participantUid.localeCompare(right.participantUid));
  const index = ranked.findIndex((row) => row.participantUid === selected.participantUid);
  return index < 0 ? undefined : index + 1;
}

export async function getAdminLiveParticipantDetail(
  eventIdOrSlug: string,
  participantUidOrBib: string,
  canonicalOnly = false,
): Promise<AdminLiveParticipantDetail | null> {
  const event = await getPlatformEvent(eventIdOrSlug, true);
  if (!event) return null;
  const kv = await getKv();
  const [payload, canonical, hubConfig, index] = await Promise.all([
    kv.get<unknown>(`${PREFIX}:live:event:${event.eventId}:participants`, "json"),
    getCanonicalLiveEvent(event.eventId),
    kv.get<AdminHubConfig>(`${PREFIX}:live:event:${event.eventId}:hub-config`, "json"),
    getCanonicalParticipantIndex(event.eventId),
  ]);
  const rawRows = unpackParticipants(payload);
  const wanted = participantUidOrBib.trim();
  const raw = rawRows.find((row) => {
    const uid = stringValue(row, "participantUid", "participantUuid", "participant_uuid", "uuid", "id");
    const bib = stringValue(row, "bib", "bibNumber", "bib_number");
    return uid === wanted || bib === wanted;
  }) ?? null;
  const pinnedParticipant = await getCanonicalLiveParticipant(event.eventId, wanted);
  const indexRow = index?.rows.find((row) =>
    row.participantUuid === wanted || row.sourceParticipantUid === wanted || row.bib === wanted
    || row.participantUuid === pinnedParticipant?.participant.participantUid
    || row.sourceParticipantUid === pinnedParticipant?.participant.participantUid,
  );
  const canonicalParticipant = pinnedParticipant?.participant
    ?? canonical?.participants.find((row) => row.participantUid === wanted || row.bib === wanted);
  const publishedAthlete = !canonicalOnly && !canonicalParticipant && !raw
    ? (await getResults(event.slug)).athletes.find((athlete) => athlete.id === wanted || athlete.athleteUid === wanted || athlete.bib === wanted)
    : undefined;
  const baseParticipant = canonicalParticipant
    ?? (canonicalOnly ? null : raw ? normalizeLiveRecord(raw, event.eventId) : publishedAthlete ? athleteToLiveParticipant(publishedAthlete) : null);
  if (!baseParticipant) return null;
  const gunStartAt = hubConfig?.start?.gunStartAt ?? null;
  const configuredSplits = [...(hubConfig?.splits ?? [])].sort((left, right) => left.order - right.order);
  const configuredById = new Map(configuredSplits.map((split) => [split.id, split]));
  const configuredByName = new Map(configuredSplits.map((split) => [split.name.trim().toLowerCase(), split]));
  const enrichedSplits = baseParticipant.splits.map((split) => {
    const configured = configuredById.get(split.splitId) ?? configuredByName.get(split.name.trim().toLowerCase());
    const distanceKm = split.distanceKm ?? configured?.distanceKm ?? undefined;
    const elapsedMs = split.officialTimeMs ?? split.chipTimeMs;
    const paceOrSpeed = split.paceOrSpeed || (distanceKm && elapsedMs !== undefined && elapsedMs > 0
      ? `${Math.floor(elapsedMs / 60_000 / distanceKm)}:${String(Math.round((elapsedMs / 1_000 / distanceKm) % 60)).padStart(2, "0")} /km`
      : undefined);
    const timestamp = timestampFromGunStart(split, gunStartAt);
    return { ...split, distanceKm, paceOrSpeed, timestamp: split.timestamp || timestamp || undefined, readerTimestamp: split.readerTimestamp || timestamp || undefined };
  });
  const firstStart = enrichedSplits.find((split) => /start/i.test(`${split.splitId} ${split.name}`));
  const finishPointIds = new Set((hubConfig?.timingPoints ?? [])
    .filter((point) => point.type === "FINISH")
    .map((point) => point.id));
  const configuredRaceFinish = configuredSplits.length > 0
    && finishPointIds.has(configuredSplits.at(-1)?.timingPointId ?? "")
      ? configuredSplits.at(-1)!
      : null;
  const lastFinish = baseParticipant.raceStatus === "FINISHED" && configuredRaceFinish
    ? enrichedSplits.find((split) => split.splitId === configuredRaceFinish.id
      || split.name.trim().toLowerCase() === configuredRaceFinish.name.trim().toLowerCase())
    : undefined;
  const latest = enrichedSplits.at(-1);
  const latestConfigured = latest ? configuredById.get(latest.splitId) ?? configuredByName.get(latest.name.trim().toLowerCase()) : undefined;
  const currentLegConfig = hubConfig?.legs?.find((leg) => leg.id === latestConfigured?.legId);
  const totalDistanceKm = (hubConfig?.legs ?? []).reduce((total, leg) => total + (leg.distanceKm ?? 0), 0);
  const distanceCompletedKm = baseParticipant.raceStatus === "FINISHED"
    ? totalDistanceKm || latest?.distanceKm
    : latest?.distanceKm;
  const sourceAgeGroup = raw ? stringValue(raw, "ageGroup", "age_group", "ageGroupName", "age_group_name") : "";
  const sourceGender = raw ? stringValue(raw, "gender", "sex") : "";
  const participant: LiveParticipant = {
    ...baseParticipant,
    ageGroup: baseParticipant.ageGroup || sourceAgeGroup || undefined,
    gender: baseParticipant.gender || sourceGender || undefined,
    country: baseParticipant.country || (raw ? stringValue(raw, "country", "countryCode", "country_code") : "") || undefined,
    club: baseParticipant.club || (raw ? stringValue(raw, "club", "clubName", "club_name") : "") || undefined,
    currentLeg: baseParticipant.currentLeg || currentLegConfig?.type || currentLegConfig?.name || undefined,
    distanceCompletedKm,
    progressPercent: baseParticipant.progressPercent ?? (baseParticipant.raceStatus === "FINISHED" ? 100 : distanceCompletedKm !== undefined && totalDistanceKm > 0 ? Math.min(100, distanceCompletedKm / totalDistanceKm * 100) : undefined),
    estimatedFinishAt: baseParticipant.raceStatus === "FINISHED"
      ? timestampFromGunStart(lastFinish, gunStartAt) || undefined
      : undefined,
    overallRank: baseParticipant.overallRank ?? provisionalRank(baseParticipant, canonical?.participants ?? [baseParticipant], rawRows),
    genderRank: baseParticipant.genderRank ?? provisionalRank(baseParticipant, canonical?.participants ?? [baseParticipant], rawRows, "gender"),
    ageGroupRank: baseParticipant.ageGroupRank ?? provisionalRank(baseParticipant, canonical?.participants ?? [baseParticipant], rawRows, "ageGroup"),
    splits: enrichedSplits,
  };
  const manifest = pinnedParticipant?.manifest ?? canonical?.manifest;
  return {
    event: { id: event.eventId, slug: event.slug, name: event.name },
    participant,
    identity: {
      email: raw ? stringValue(raw, "email", "emailAddress", "email_address") || null : null,
      chipCode: indexRow?.chipCode || (raw ? stringValue(raw, "chipCode", "chip_code", "chip", "rfid") : "") || null,
      providerEventUuid: indexRow?.providerEventUuid || (raw ? stringValue(raw, "providerEventUuid", "eventUuid", "event_uuid", "EventUUID") : "") || null,
      providerParticipantUuid: indexRow?.providerParticipantUuid || (raw ? stringValue(raw, "providerParticipantUuid", "provider_participant_uuid", "feibotParticipantUuid", "participantUuid", "participant_uuid", "uuid", "id") : "") || null,
      contestUuid: indexRow?.contestUuid || (raw ? stringValue(raw, "contestUuid", "contest_uuid", "providerContestUuid") : "") || null,
      dateOfBirth: raw ? stringValue(raw, "dateOfBirth", "date_of_birth", "dob") || null : null,
      waveStartTime: indexRow?.waveStartTime || (raw ? stringValue(raw, "waveStartTime", "wave_start_time") : "") || null,
      acceptedStartTime: (raw ? stringValue(raw, "chipStartTime", "chip_start_time", "acceptedStartTime", "startTime", "start_time") : "") || timestampFromGunStart(firstStart, gunStartAt),
      finishTime: baseParticipant.raceStatus === "FINISHED"
        ? timestampFromGunStart(lastFinish, gunStartAt)
        : null,
      currentSplit: (raw ? stringValue(raw, "currentSplit", "current_split", "lastSplit", "last_split") : "") || participant.latestTimingPoint || latest?.name || null,
      statusDetail: indexRow?.statusReason || (raw ? stringValue(raw, "statusDetail", "status_detail", "statusReason", "status_reason") : "") || (participant.timingSource === "FEIBOT_PROCESSED" ? "Accepted official Feibot timing result" : null),
    },
    canonical: {
      buildVersion: manifest?.activeVersion ?? manifest?.version ?? null,
      updatedAt: canonicalManifestUpdatedAt(manifest) ?? null,
      courseVersion: manifest?.courseVersion ?? null,
      timingVersion: manifest?.timingVersion ?? null,
      leaderboardVersion: manifest?.leaderboardVersion ?? null,
    },
  };
}

export async function saveAdminLiveParticipantVisibility(
  eventIdOrSlug: string,
  participantUid: string,
  visibility: AthleteVisibility | null,
): Promise<AdminLiveParticipantVisibility> {
  const loaded = await getAdminLiveParticipantVisibility(eventIdOrSlug);
  if (!loaded) throw new Error("Event not found.");
  const row = loaded.rows.find((item) => item.participant.participantUid === participantUid);
  if (!row) throw new Error("Participant not found in this event.");
  const kv = await getKv();
  const key = `${PREFIX}:live:event:${loaded.event.eventId}:${VISIBILITY_OVERRIDE_SUFFIX}`;
  const current = (await kv.get<Record<string, AthleteVisibility>>(key, "json")) ?? {};
  const next = { ...current };
  if (visibility) next[participantUid] = visibility;
  else delete next[participantUid];
  const auditId = crypto.randomUUID();
  const updatedAt = new Date().toISOString();
  await Promise.all([
    kv.put(key, JSON.stringify(next)),
    kv.put(`${PREFIX}:timing:audit:${auditId}`, JSON.stringify({
      id: auditId,
      action: visibility ? "ATHLETE_VISIBILITY_OVERRIDDEN" : "ATHLETE_VISIBILITY_OVERRIDE_REMOVED",
      entity: row.participant.displayName || row.participant.bib || participantUid,
      eventId: loaded.event.eventId,
      participantUid,
      visibility,
      actor: "Race Upshot admin",
      createdAt: updatedAt,
    })),
  ]);
  const auditIndex = (await kv.get<string[]>(`${PREFIX}:timing:audit:index`, "json")) ?? [];
  if (!auditIndex.includes(auditId)) {
    await kv.put(`${PREFIX}:timing:audit:index`, JSON.stringify([...auditIndex, auditId]));
  }
  return { participant: row.participant, override: visibility };
}

export async function getPublicLiveParticipant(
  eventIdOrSlug: string,
  participantUid: string,
  viewer?: ParticipantViewer,
  resolvedEvent?: PublicEvent,
): Promise<PlatformRead<LiveParticipant> | null> {
  // Canonical athlete rows persist their event-scoped ranks. Keep this lookup
  // targeted so mobile polling never reads the complete participant snapshot.
  const participants = await getPublicParticipants(
    eventIdOrSlug,
    "live",
    viewer,
    participantUid,
    resolvedEvent,
  );
  if (!participants) return null;
  const participant = participants.data.find((row) => row.participantUid === participantUid || row.bib === participantUid);
  return participant ? { ...participants, data: participant } : null;
}

export async function getPublicResultParticipant(
  eventIdOrSlug: string,
  participantUid: string,
  viewer?: ParticipantViewer,
  resolvedEvent?: PublicEvent,
): Promise<PlatformRead<LiveParticipant> | null> {
  // Published result detail routes already carry the stable result record ID.
  // Resolve that one KV row first instead of loading and normalizing the
  // event's complete participant/result payload. Privacy is still applied
  // with the same athlete preference and admin override used by bulk reads.
  const stored = await getAthleteResult(eventIdOrSlug, participantUid);
  if (stored) {
    const event = resolvedEvent ?? await getPlatformEvent(stored.event.id);
    if (!event) return null;
    const kv = await getKv();
    const participant = athleteToLiveParticipant(stored.athlete);
    const [context, visibilityOverrides] = await Promise.all([
      privacyContextFromIdentity(kv, stored.athlete.athleteUid, stored.athlete.email),
      kv.get<Record<string, AthleteVisibility>>(
        `${PREFIX}:live:event:${event.eventId}:${VISIBILITY_OVERRIDE_SUFFIX}`,
        "json",
      ),
    ]);
    const privacySettings = {
      ...event.liveSettings,
      liveTrackingEnabled: true,
      publicLiveTrackingEnabled: true,
    };
    const rawVisibility = participant.visibility ?? normalizeVisibility("PUBLIC");
    const adminOverride = visibilityOverrides?.[participant.participantUid] ?? null;
    const data = viewerOwnsParticipant(viewer, context)
      ? {
          ...participant,
          visibility: resolveAthleteVisibility({
            eventSettings: privacySettings,
            athletePreference: context.preference?.liveTrackingVisibility ?? rawVisibility,
            adminOverride,
          }),
        }
      : applyPublicAthletePrivacy(
          { ...participant, visibility: rawVisibility },
          privacySettings,
          context.preference,
          adminOverride,
        );
    if (!data) return null;
    return {
      data,
      lastUpdatedAt: null,
      source: "published-results",
      provider: "RACE_UPSHOT",
      isStale: false,
      cacheSeconds: DEFAULT_CACHE_SECONDS,
    };
  }
  const participants = await getPublicParticipants(
    eventIdOrSlug,
    "results",
    viewer,
    participantUid,
    resolvedEvent,
  );
  if (!participants) return null;
  const participant = participants.data.find((row) => row.participantUid === participantUid || row.bib === participantUid);
  return participant ? { ...participants, data: participant } : null;
}

export async function getPublicLeaderboard(eventIdOrSlug: string, contestId?: string, viewer?: ParticipantViewer): Promise<PlatformRead<LiveParticipant[]> | null> {
  const event = await getPlatformEvent(eventIdOrSlug, true);
  const participants = event && (event.section === "LIVE" || event.liveSettings.liveTrackingEnabled)
    ? await getPublicLiveParticipants(eventIdOrSlug, viewer)
    : await getPublicResultParticipants(eventIdOrSlug, viewer);
  if (!participants) return null;
  const ranked = participants.data
    .filter((participant) => !contestId || participant.contestId === contestId || participant.contestName === contestId)
    .filter((participant) => participant.overallRank !== undefined)
    .sort((a, b) => (a.overallRank ?? Number.MAX_SAFE_INTEGER) - (b.overallRank ?? Number.MAX_SAFE_INTEGER));
  return { ...participants, data: ranked };
}

export async function getEventAnnouncements(eventIdOrSlug: string): Promise<PlatformRead<Announcement[]> | null> {
  const event = await getPlatformEvent(eventIdOrSlug, true);
  if (!event) return null;
  const kv = await getKv();
  const globalRows = (await kv.get<Announcement[]>(`${PREFIX}:announcements:active`, "json")) ?? [];
  const eventRows = (await kv.get<Announcement[]>(`${PREFIX}:event:${event.eventId}:announcements`, "json")) ?? [];
  const now = Date.now();
  const rows = [...globalRows, ...eventRows]
    .filter((announcement) => announcement.active)
    .filter((announcement) => !announcement.eventId || announcement.eventId === event.eventId)
    .filter((announcement) => !announcement.startsAt || Date.parse(announcement.startsAt) <= now)
    .filter((announcement) => !announcement.endsAt || Date.parse(announcement.endsAt) >= now)
    .sort((a, b) => b.priority - a.priority);
  return {
    data: rows,
    lastUpdatedAt: rows[0]?.startsAt ?? null,
    source: "raceupshot",
    isStale: false,
    cacheSeconds: 30,
  };
}

export async function getEventCourse(
  eventIdOrSlug: string,
  options: { surface?: "web" | "mobile"; category?: string | null } = {},
): Promise<PlatformRead<EventCourseView> | null> {
  const event = await getPlatformEvent(eventIdOrSlug);
  if (!event) return null;
  const course = await getPublicEventCourseMaps(event.eventId, {
    surface: options.surface ?? "web",
    category: options.category,
  });
  if (!course) return null;
  return {
    data: course,
    lastUpdatedAt: course.updatedAt,
    source: "raceupshot",
    isStale: course.maps.length === 0,
    cacheSeconds: 60,
  };
}

export function createDefaultFeibotIntegration(eventId: string): FeibotIntegrationConfig {
  return {
    provider: "FEIBOT",
    enabled: false,
    baseUrl: "https://apicn.feibot.com",
    accountReference: "FEIBOT_MAIN",
    providerEventUuid: "",
    contestMappings: [],
    syncParticipants: true,
    syncContests: true,
    syncTimingPoints: true,
    syncRealtime: true,
    syncLeaderboards: true,
    syncResults: true,
    participantSyncIntervalSeconds: 300,
    realtimeSyncIntervalSeconds: 10,
    leaderboardSyncIntervalSeconds: 15,
    resultSyncIntervalSeconds: 60,
    enabledForWeb: true,
    enabledForMobile: true,
    timingResultSource: "FEIBOT_PROCESSED",
    resultTimeMode: "CHIP",
    passageGapMs: 5_000,
    readerDetectionTimeoutMs: {},
    status: eventId ? "NOT_CONFIGURED" : "NOT_CONFIGURED",
    lastTestedAt: null,
    lastSuccessfulSyncAt: null,
    updatedAt: new Date().toISOString(),
  };
}
