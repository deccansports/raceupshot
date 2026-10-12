import { isDevelopment } from "@/core/constants/env";
import { api, liveApi } from "@/core/services/api";
import { queryClient } from "@/core/services/query/queryClient";
import { queryKeys } from "@/core/services/query/queryKeys";
import type { LiveAthlete, LiveEventDto } from "@/core/types";
import {
  readCachedEvent,
  readCachedRulesHtml,
  writeEventContentCache,
} from "@/core/cache/eventContentCache";
import {
  readCachedEventList,
  writeCachedEventList,
} from "@/core/cache/eventListCache";

export type EventTrackingResponse = {
  success: boolean;
  participants?: LiveAthlete[];
  athletes?: LiveAthlete[];
};

export type EventTicketsResponse = {
  success: boolean;
  eventId?: string;
  source?: "kv" | "firestore" | string;
  count?: number;
  tickets?: Record<string, unknown>[];
};

export type EventPartner = {
  id: string;
  name: string;
  logoUrl: string;
  website?: string | null;
  type?: string | null;
  order: number;
};

export type EventPartnersResponse = {
  success: boolean;
  eventId: string;
  count: number;
  sponsors: EventPartner[];
};

export type PublicContestCutoff = {
  contestUuid?: string | null;
  contestName?: string | null;
  cutoffs?: Record<string, unknown> | unknown[] | null;
  subCategories?: unknown[] | null;
  ticketName?: string | null;
  order?: number | null;
};

export type PublicCourseCutoffsResponse = {
  success: boolean;
  eventId: string;
  contests: PublicContestCutoff[];
};

export type ActiveAnnouncement = {
  id: string;
  title: string;
  message: string;
  actionUrl?: string | null;
  actionLabel?: string | null;
  type?: string | null;
  isActive?: boolean;
  startDate?: string | null;
  endDate?: string | null;
  priority?: number;
  dismissible?: boolean;
  targetScreens?: ("home" | "account")[] | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type HomepageSliderItem = {
  id: string;
  type: "image" | "video" | string;
  src: string;
  mobileSrc?: string | null;
  alt?: string | null;
  eventId?: string | null;
  customUrl?: string | null;
  header?: string | null;
  description?: string | null;
  customLinkText?: string | null;
  mobileFocusX?: number | null;
  mobileFocusY?: number | null;
  showOnHomepage?: boolean;
};

const PUBLIC_ANNOUNCEMENTS_COOLDOWN_MS = 5 * 60 * 1000;

let lastPublicAnnouncementsResponse: {
  key: string;
  value: {
    announcements: ActiveAnnouncement[];
    count: number;
    role: string;
    eventId: string | null;
  };
} | null = null;
let publicAnnouncementsCooldownUntil = 0;

export interface IEventsRepository {
  getLiveEvents(
    signal?: AbortSignal,
    options?: { preferNetwork?: boolean; cacheScope?: string },
  ): Promise<LiveEventDto[]>;
  getEventDetail(eventId: string, signal?: AbortSignal): Promise<LiveEventDto>;
  getEventLiveSummary(
    eventId: string,
    signal?: AbortSignal,
  ): Promise<LiveEventDto>;
  getEventTickets(
    eventId: string,
    signal?: AbortSignal,
  ): Promise<EventTicketsResponse>;
  getEventPartners(
    eventId: string,
    signal?: AbortSignal,
  ): Promise<EventPartnersResponse>;
  getEventCourseCutoffs(
    eventId: string,
    signal?: AbortSignal,
  ): Promise<PublicCourseCutoffsResponse>;
  getEventRules(eventId: string, signal?: AbortSignal): Promise<string | null>;
  getEventTracking(
    eventId: string,
    signal?: AbortSignal,
  ): Promise<EventTrackingResponse>;
  getActiveAnnouncement(
    signal?: AbortSignal,
  ): Promise<ActiveAnnouncement | null>;
  getPublicAnnouncements(
    role?: "athlete" | "admin",
    eventId?: string | null,
    signal?: AbortSignal,
  ): Promise<{
    announcements: ActiveAnnouncement[];
    count: number;
    role: string;
    eventId: string | null;
  }>;
  getHomepageSlider(signal?: AbortSignal): Promise<HomepageSliderItem[]>;
}

type LiveEventsPayload = {
  success: boolean;
  events?: LiveEventDto[];
  event?: LiveEventDto;
  data?: {
    events?: LiveEventDto[];
    event?: LiveEventDto;
    data?: {
      events?: LiveEventDto[];
      event?: LiveEventDto;
    };
  };
};

function toText(value: unknown): string | undefined {
  const text = String(value ?? "").trim();
  return text ? text : undefined;
}

function firstText(...values: unknown[]): string | undefined {
  for (const value of values) {
    const text = toText(value);
    if (text) return text;
  }
  return undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function mergeDefinedRecords<T extends Record<string, unknown>>(
  ...sources: (T | null | undefined)[]
): T {
  const merged: Record<string, unknown> = {};

  for (const source of sources) {
    if (!isPlainObject(source)) continue;

    for (const [key, value] of Object.entries(source)) {
      if (value === null || value === undefined) continue;

      const current = merged[key];

      if (isPlainObject(current) && isPlainObject(value)) {
        merged[key] = mergeDefinedRecords(current, value);
        continue;
      }

      if (Array.isArray(current)) {
        continue;
      }

      if (current === undefined || current === null) {
        merged[key] = value;
      }
    }
  }

  return merged as T;
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function parseDate(value: string | null | undefined): Date | null {
  const candidate = value?.trim();
  if (!candidate) return null;
  const parsed = new Date(candidate);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeStatusText(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function isPlaceholderPublicEvent(source: Record<string, unknown>): boolean {
  const name = String(
    source.eventName ?? source.name ?? source.title ?? "",
  ).trim();
  const eventId = String(
    source.eventId ?? source.id ?? source.event_id ?? source.slug ?? "",
  )
    .trim()
    .toLowerCase();
  const isHidden = source.isHidden === true;
  const isAdminOnly = source.adminOnly === true || source.isAdminOnly === true;
  return (
    isHidden ||
    /^event\s+/i.test(name) ||
    // The server controls visibility for admin-only events. An authenticated
    // admin must be able to use a deliberately named Test/Smoke Test event;
    // only discard those IDs when they came from an unauthorised public feed.
    (!isAdminOnly && eventId.includes("test")) ||
    eventId.includes("placeholder")
  );
}

function derivePublicStatus(source: Record<string, unknown>): string {
  const now = Date.now();
  const startDate = parseDate(
    firstText(
      source.startDate,
      source.dateStart,
      source.eventDate,
      source.date,
    ),
  );
  const endDate = parseDate(firstText(source.endDate, source.dateEnd));
  const lifecycleBaseline = endDate ?? startDate;
  const pastAt = lifecycleBaseline ? lifecycleBaseline.getTime() + 24 * 60 * 60 * 1000 : null;
  if (startDate && now < startDate.getTime()) return "upcoming";
  if (pastAt !== null && now >= pastAt) return "finished";
  if (startDate && now >= startDate.getTime()) return "live";
  const stored = normalizeStatusText(source.status);
  if (
    stored.includes("finish") ||
    stored.includes("complete") ||
    stored.includes("done") ||
    stored.includes("closed") ||
    stored.includes("ended") ||
    stored.includes("result")
  ) {
    if (pastAt !== null && now < pastAt) return "live";
    return "finished";
  }
  if (
    stored.includes("live") ||
    stored.includes("ongoing") ||
    stored.includes("progress")
  )
    return "live";
  if (
    stored.includes("upcoming") ||
    stored.includes("scheduled") ||
    stored.includes("start") ||
    stored.includes("open")
  )
    return "upcoming";
  return "upcoming";
}

function extractImageUri(source: Record<string, unknown>): string | null {
  const raw =
    source.raw && typeof source.raw === "object"
      ? (source.raw as Record<string, unknown>)
      : undefined;
  const courseDetails =
    source.courseDetails && typeof source.courseDetails === "object"
      ? (source.courseDetails as Record<string, unknown>)
      : undefined;
  const media =
    courseDetails?.media && typeof courseDetails.media === "object"
      ? (courseDetails.media as Record<string, unknown>)
      : undefined;

  return (
    firstText(
      source.photoUrl,
      source.imageUri,
      source.imageUrl,
      source.bannerUrl,
      source.bannerImage,
      source.bannerImageUrl,
      source.coverImage,
      source.coverImageUrl,
      source.posterImage,
      source.posterImageUrl,
      source.posterUrl,
      source.heroImage,
      source.heroImageUrl,
      source.thumbnailUrl,
      source.eventImage,
      source.eventImageUrl,
      source.logoUrl,
      raw?.photoUrl,
      raw?.imageUri,
      raw?.imageUrl,
      raw?.bannerUrl,
      raw?.bannerImage,
      raw?.bannerImageUrl,
      raw?.coverImage,
      raw?.coverImageUrl,
      raw?.posterImage,
      raw?.posterImageUrl,
      raw?.posterUrl,
      raw?.heroImage,
      raw?.heroImageUrl,
      raw?.thumbnailUrl,
      raw?.eventImage,
      raw?.eventImageUrl,
      raw?.logoUrl,
      courseDetails?.photoUrl,
      courseDetails?.imageUri,
      courseDetails?.imageUrl,
      courseDetails?.bannerUrl,
      courseDetails?.bannerImage,
      courseDetails?.bannerImageUrl,
      courseDetails?.coverImage,
      courseDetails?.coverImageUrl,
      media?.hero,
      media?.banner,
      media?.cover,
      media?.thumbnail,
    ) ?? null
  );
}

function normalizeBlocks(
  value: unknown,
): { id?: string | null; html?: string | null }[] | null {
  if (!Array.isArray(value)) return null;

  const blocks = value
    .map((item, index) => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const html = firstText(
        record.html,
        record.content,
        record.body,
        record.value,
      );
      if (!html) return null;
      return {
        id:
          firstText(record.id, record.blockId, record.key, record.slug) ??
          `block-${index + 1}`,
        html,
      };
    })
    .filter(Boolean) as { id?: string | null; html?: string | null }[];

  return blocks.length > 0 ? blocks : null;
}

function extractEventPayload(
  response:
    | { success?: boolean; data?: unknown; event?: unknown }
    | LiveEventDto
    | Record<string, unknown>,
): Record<string, unknown> | LiveEventDto {
  if (response && typeof response === "object") {
    const envelope = response as { data?: unknown; event?: unknown };
    const nestedData = envelope.data as
      { event?: unknown; data?: unknown } | undefined;
    const candidate =
      envelope.event ??
      nestedData?.event ??
      nestedData?.data ??
      envelope.data ??
      response;
    return candidate && typeof candidate === "object"
      ? (candidate as Record<string, unknown>)
      : (response as Record<string, unknown>);
  }

  return response as LiveEventDto;
}

async function fetchEventDetailPayload(
  eventId: string,
  signal?: AbortSignal,
): Promise<Record<string, unknown> | LiveEventDto> {
  const response = await api.json<
    { success?: boolean; data?: unknown; event?: LiveEventDto } | LiveEventDto
  >(`/api/events/${eventId}`, { signal });
  return extractEventPayload(response);
}

function normalizeEvent(
  event: LiveEventDto | Record<string, unknown>,
): LiveEventDto {
  const sourceInput = event as Record<string, unknown>;
  const source =
    sourceInput.raw && typeof sourceInput.raw === "object"
      ? mergeDefinedRecords(
          sourceInput.raw as Record<string, unknown>,
          sourceInput,
        )
      : sourceInput;
  const raw =
    source.raw && typeof source.raw === "object"
      ? (source.raw as Record<string, unknown>)
      : undefined;
  const distances: string[] | string | null | undefined = Array.isArray(
    source.distances,
  )
    ? source.distances
        .filter((item) => item != null && String(item).trim())
        .map(String)
    : typeof source.distances === "string"
      ? source.distances
      : source.distances == null
        ? null
        : String(source.distances);

  const courseDetails =
    source.courseDetails && typeof source.courseDetails === "object"
      ? (source.courseDetails as Record<string, unknown>)
      : undefined;
  const cutoffs = source.cutoffs ?? courseDetails?.cutoffs ?? null;
  const athleteGuidebookUrl =
    firstText(
      source.athleteGuidebookUrl,
      source.athleteGuideBookUrl,
      source.athleteGuideUrl,
      source.guidebookUrl,
      source.guideBookUrl,
      source.guideUrl,
      source.pdfUrl,
      source.downloadUrl,
      courseDetails?.athleteGuidebookUrl,
      courseDetails?.athleteGuideBookUrl,
      courseDetails?.athleteGuideUrl,
      courseDetails?.guidebookUrl,
      courseDetails?.guideBookUrl,
      courseDetails?.guideUrl,
      courseDetails?.pdfUrl,
      courseDetails?.downloadUrl,
    ) ?? null;

  return {
    ...source,
    id: String(
      source.id ??
        source.eventId ??
        source.event_id ??
        source.docId ??
        source.slug ??
        "",
    ).trim(),
    eventId: toText(
      source.eventId ?? source.id ?? source.event_id ?? source.slug,
    ),
    name: toText(source.eventName ?? source.name ?? source.title) || "",
    eventName: toText(source.eventName ?? source.name ?? source.title),
    date: toText(source.date ?? source.eventDate ?? source.raceDate) || null,
    eventDate:
      toText(source.eventDate ?? source.date ?? source.raceDate) || null,
    displayDateRange: toText(source.displayDateRange) || null,
    displayDate: toText(source.displayDate) || null,
    dateRange: toText(source.dateRange) || null,
    dateLabel: toText(source.dateLabel) || null,
    startDate: toText(source.startDate) || null,
    startAt: toText(source.startAt) || null,
    countdownTargetAt: toText(source.countdownTargetAt) || null,
    timezone: toText(source.timezone) || null,
    endDate: toText(source.endDate) || null,
    dateStart: toText(source.dateStart) || null,
    dateEnd: toText(source.dateEnd) || null,
    ticketDate: toText(source.ticketDate) || null,
    ticketDates: Array.isArray(source.ticketDates)
      ? source.ticketDates.map(String)
      : toText(source.ticketDates) || null,
    ticketEventDate: toText(source.ticketEventDate) || null,
    ticketEventDates: Array.isArray(source.ticketEventDates)
      ? source.ticketEventDates.map(String)
      : toText(source.ticketEventDates) || null,
    ticketCategoryDate: toText(source.ticketCategoryDate) || null,
    ticketCategoryDates: Array.isArray(source.ticketCategoryDates)
      ? source.ticketCategoryDates.map(String)
      : toText(source.ticketCategoryDates) || null,
    eventDates: Array.isArray(source.eventDates)
      ? source.eventDates.map(String)
      : toText(source.eventDates) || null,
    venueName:
      toText(source.venueName ?? source.venue ?? source.locationName) || null,
    address: toText(source.address) || null,
    photoUrl:
      firstText(source.photoUrl, source.imageUri, source.imageUrl) ?? null,
    blocks:
      normalizeBlocks(
        source.blocks ??
          (source.raw as Record<string, unknown> | undefined)?.blocks,
      ) ?? null,
    ticketDefinitions: Array.isArray(source.ticketDefinitions)
      ? (source.ticketDefinitions as Record<string, unknown>[])
      : Array.isArray(
            (source.raw as Record<string, unknown> | undefined)
              ?.ticketDefinitions,
          )
        ? ((source.raw as Record<string, unknown> | undefined)
            ?.ticketDefinitions as Record<string, unknown>[])
        : null,
    customRules:
      firstText(
        source.customRules,
        source.customRulesHtml,
        source.rulesCustomHtml,
        source.rulesContentHtml,
      ) ?? null,
    customRulesHtml:
      firstText(
        source.customRulesHtml,
        source.customRules,
        source.rulesCustomHtml,
        source.rulesContentHtml,
        courseDetails?.customRulesHtml,
        courseDetails?.customRules,
      ) ?? null,
    customContent:
      firstText(
        source.customContent,
        source.customContentHtml,
        source.contentHtml,
        (source.raw as Record<string, unknown> | undefined)?.customContent,
        (source.raw as Record<string, unknown> | undefined)?.customContentHtml,
      ) ?? null,
    disciplineSchedule:
      source.disciplineSchedule ??
      (source.raw as Record<string, unknown> | undefined)?.disciplineSchedule ??
      null,
    country: toText(source.country) || null,
    state: toText(source.state) || null,
    customSlug: toText(source.customSlug ?? source.slug) || null,
    eventSlug: toText(source.eventSlug ?? source.event_slug) || null,
    registrationStatus: toText(source.registrationStatus) || null,
    registrationButtonState: toText(source.registrationButtonState) || null,
    courseDetails: (courseDetails as Record<string, unknown> | null) ?? null,
    temperatureMetrics:
      (source.temperatureMetrics as Record<string, unknown> | null) ?? null,
    cutoffMinutes:
      toNumber(source.cutoffMinutes ?? courseDetails?.cutoffMinutes) ?? null,
    cutoffs: (cutoffs as Record<string, unknown> | unknown[] | null) ?? null,
    rulesUrl:
      firstText(
        source.rulesUrl,
        source.regulationsUrl,
        source.rulesAndRegulationsUrl,
        source.eventRulesUrl,
        source.guidelinesUrl,
        courseDetails?.rulesUrl,
        courseDetails?.regulationsUrl,
      ) ?? null,
    regulationsUrl:
      firstText(
        source.regulationsUrl,
        source.rulesUrl,
        source.rulesAndRegulationsUrl,
        source.eventRulesUrl,
        source.guidelinesUrl,
        courseDetails?.regulationsUrl,
        courseDetails?.rulesUrl,
      ) ?? null,
    rulesAndRegulationsUrl:
      firstText(
        source.rulesAndRegulationsUrl,
        source.rulesUrl,
        source.regulationsUrl,
        source.eventRulesUrl,
        source.guidelinesUrl,
        courseDetails?.rulesUrl,
        courseDetails?.regulationsUrl,
      ) ?? null,
    rulesHtml:
      firstText(
        source.rulesHtml,
        source.rulesContentHtml,
        source.rulesAndRegulationsHtml,
        courseDetails?.rulesHtml,
        courseDetails?.rulesContentHtml,
      ) ?? null,
    regulationsHtml:
      firstText(
        source.regulationsHtml,
        source.regulationsContentHtml,
        source.rulesAndRegulationsHtml,
        courseDetails?.regulationsHtml,
        courseDetails?.regulationsContentHtml,
      ) ?? null,
    rulesAndRegulationsHtml:
      firstText(
        source.rulesAndRegulationsHtml,
        source.rulesHtml,
        source.regulationsHtml,
        source.rulesContentHtml,
        source.regulationsContentHtml,
        courseDetails?.rulesAndRegulationsHtml,
      ) ?? null,
    athleteGuidebookUrl,
    athleteGuideBookUrl:
      firstText(source.athleteGuideBookUrl, athleteGuidebookUrl) ?? null,
    athleteGuideUrl: athleteGuidebookUrl,
    guidebookUrl: athleteGuidebookUrl,
    guideUrl: athleteGuidebookUrl,
    pdfUrl:
      firstText(
        source.pdfUrl,
        source.downloadUrl,
        courseDetails?.pdfUrl,
        courseDetails?.downloadUrl,
      ) ?? null,
    downloadUrl:
      firstText(
        source.downloadUrl,
        source.pdfUrl,
        courseDetails?.downloadUrl,
        courseDetails?.pdfUrl,
      ) ?? null,
    rulesContentHtml:
      firstText(source.rulesContentHtml, courseDetails?.rulesContentHtml) ??
      null,
    regulationsContentHtml:
      firstText(
        source.regulationsContentHtml,
        courseDetails?.regulationsContentHtml,
      ) ?? null,
    liveTracking:
      (source.liveTracking as Record<string, unknown> | null) ?? null,
    liveTrackingProviderState:
      (source.liveTrackingProviderState as Record<string, unknown> | null) ??
      null,
    liveDataSource: toText(source.liveDataSource) || null,
    showLiveTrackingOnHomepage:
      typeof source.showLiveTrackingOnHomepage === "boolean"
        ? source.showLiveTrackingOnHomepage
        : null,
    status: toText(source.status) || "notStarted",
    isUpcoming: Boolean(source.isUpcoming),
    imageUri: extractImageUri(source),
    imageUrl:
      firstText(
        source.imageUrl,
        source.imageUri,
        source.bannerUrl,
        raw?.imageUrl,
        raw?.imageUri,
        raw?.bannerUrl,
      ) ?? null,
    bannerImage:
      firstText(
        source.bannerImage,
        source.bannerImageUrl,
        raw?.bannerImage,
        raw?.bannerImageUrl,
      ) ?? null,
    bannerImageUrl:
      firstText(
        source.bannerImageUrl,
        source.bannerImage,
        raw?.bannerImageUrl,
        raw?.bannerImage,
      ) ?? null,
    coverImage:
      firstText(
        source.coverImage,
        source.coverImageUrl,
        raw?.coverImage,
        raw?.coverImageUrl,
      ) ?? null,
    coverImageUrl:
      firstText(
        source.coverImageUrl,
        source.coverImage,
        raw?.coverImageUrl,
        raw?.coverImage,
      ) ?? null,
    location: toText(source.location) || null,
    discipline: toText(source.discipline) || null,
    distances,
    raw: (source.raw as Record<string, unknown> | undefined) ?? source,
  };
}

function normalizeAnnouncement(value: unknown): ActiveAnnouncement | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const title = firstText(record.title, record.heading, record.label);
  const message = firstText(
    record.message,
    record.body,
    record.text,
    record.content,
  );
  if (!title && !message) return null;
  return {
    id:
      firstText(record.id, record.announcementId, record.slug, record.key) ||
      "active-announcement",
    title: title || "Announcement",
    message: message || title || "",
    actionUrl:
      firstText(
        record.actionUrl,
        record.href,
        record.url,
        record.link,
        record.targetUrl,
      ) ?? null,
    actionLabel:
      firstText(record.actionLabel, record.linkText, record.ctaLabel) ?? null,
    type: firstText(record.type) ?? null,
    isActive:
      typeof record.isActive === "boolean" ? record.isActive : undefined,
    startDate: firstText(record.startDate) ?? null,
    endDate: firstText(record.endDate) ?? null,
  };
}

function extractAnnouncementsPayload(response: unknown): ActiveAnnouncement[] {
  const queue: unknown[] = [response];
  const seen = new Set<unknown>();
  const results: ActiveAnnouncement[] = [];

  while (queue.length > 0) {
    const value = queue.shift();
    if (!value || seen.has(value)) continue;
    if (typeof value === "object") seen.add(value);
    if (Array.isArray(value)) {
      queue.push(...value);
      continue;
    }
    if (typeof value !== "object") continue;
    const record = value as Record<string, unknown>;
    const direct = normalizeAnnouncement(record);
    if (direct) results.push(direct);
    queue.push(
      record.data,
      record.announcement,
      record.announcements,
      record.items,
      record.rows,
      record.results,
      record.payload,
    );
  }

  return results;
}

function extractEventId(source: Record<string, unknown>): string | null {
  return (
    toText(source.eventId) ??
    toText(source.id) ??
    toText(source.event_id) ??
    toText(source.slug) ??
    toText(source.docId) ??
    null
  );
}

type EventsListPayload = {
  success?: boolean;
  events?: LiveEventDto[] | LiveEventDto;
  data?: {
    events?: LiveEventDto[] | LiveEventDto;
    data?: LiveEventDto[] | LiveEventDto;
  };
};

function extractEventsFromPayload(
  payload: EventsListPayload | unknown,
): LiveEventDto[] {
  const root =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as { events?: unknown; data?: unknown })
      : undefined;

  const nestedData =
    root?.data && typeof root.data === "object" && !Array.isArray(root.data)
      ? (root.data as { events?: unknown; data?: unknown })
      : undefined;

  const candidate =
    root?.events ?? nestedData?.events ?? nestedData?.data ?? root?.data;

  if (Array.isArray(candidate)) {
    return candidate.filter(
      (event): event is LiveEventDto =>
        event != null && typeof event === "object",
    );
  }

  return [];
}

function normalizeEventsList(events: unknown[]): LiveEventDto[] {
  return events.reduce<LiveEventDto[]>((acc, event, index) => {
    if (!event || typeof event !== "object") {
      if (isDevelopment) {
        console.log("[events] Skipping invalid event row", {
          index,
          eventId: null,
        });
      }
      return acc;
    }

    const source = event as Record<string, unknown>;
    if (isPlaceholderPublicEvent(source)) {
      if (isDevelopment) {
        console.log("[events] Skipping placeholder public event", {
          index,
          eventId: extractEventId(source),
          eventName: String(
            source.eventName ?? source.name ?? source.title ?? "",
          ),
        });
      }
      return acc;
    }

    const payload = {
      ...source,
      status: derivePublicStatus(source),
    };

    try {
      return [...acc, normalizeEvent(payload)];
    } catch (error) {
      if (isDevelopment) {
        console.log("[events] Failed to map event", {
          error: error instanceof Error ? error.message : "Unknown error",
          eventId: extractEventId(source),
        });
      }
      return acc;
    }
  }, []);
}

const EVENT_LIST_NETWORK_TIMEOUT_MS = 15_000;

async function fetchEventListFromNetwork(
  signal?: AbortSignal,
): Promise<LiveEventDto[]> {
  const endpoints = [
    "/api/mobile/events",
    "/api/live/events",
    "https://api.bergmantri.com/v1/events",
  ] as const;

  let lastError: unknown = new Error("Event list unavailable");
  for (const url of endpoints) {
    try {
      // `/api/mobile/events` and `/api/live/events` include admin-only events
      // only when the Firebase bearer token is present. Do not use the public
      // client for those first-party endpoints or an authenticated admin will
      // receive the public, filtered event list.
      const client = url.startsWith("/api/") ? liveApi : api;
      const response = await client.json<LiveEventsPayload>(url, {
        signal,
        timeoutMs: EVENT_LIST_NETWORK_TIMEOUT_MS,
      });
      const events = normalizeEventsList(extractEventsFromPayload(response));
      if (events.length === 0) {
        throw new Error(`Event list was empty from ${url}`);
      }
      // `/api/mobile/events` carries the canonical results and registration
      // lifecycle. Public feeds are fallbacks only and must not win a race
      // with an older REGISTER/details projection.
      return events;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

export const ProductionEventsRepository: IEventsRepository = {
  async getLiveEvents(signal, options) {
    const cacheScope = options?.cacheScope || 'public';
    const cachedEvents = normalizeEventsList(
      await readCachedEventList(cacheScope),
    );
    const networkRequest = fetchEventListFromNetwork(signal);

    const refreshInBackground = () => {
      void networkRequest
        .then(async (freshEvents) => {
          await writeCachedEventList(freshEvents, cacheScope);
          queryClient.setQueryData(
            queryKeys.events.scopedList(cacheScope),
            freshEvents,
          );
          if (cacheScope === 'public') {
            queryClient.setQueryData(queryKeys.events.list, freshEvents);
          }
        })
        .catch(() => undefined);
    };

    if (cachedEvents.length > 0) {
      // Authenticated event caches are scoped by Firebase UID, so an admin can
      // paint the last verified private list immediately without exposing it to
      // a guest or another account. Network reconciliation remains in flight.
      refreshInBackground();
      return cachedEvents;
    }

    // Admin-only visibility is decided by the authenticated first-party API.
    // Once Firebase authentication has settled, do not let a previously cached
    // public list win over the bearer-authenticated response.
    if (options?.preferNetwork) {
      const events = await networkRequest;
      void writeCachedEventList(events, cacheScope);
      return events;
    }

    const events = await networkRequest;
    void writeCachedEventList(events, cacheScope);
    return events;
  },
  async getEventDetail(eventId, signal) {
    try {
      const response = await fetchEventDetailPayload(eventId, signal);
      const normalized = normalizeEvent(response);
      void writeEventContentCache(eventId, { event: normalized });
      return normalized;
    } catch (error) {
      const cached = await readCachedEvent(eventId);
      if (cached) {
        return normalizeEvent(cached);
      }
      throw error;
    }
  },
  async getEventLiveSummary(eventId, signal) {
    const response = await liveApi.json<
      { success?: boolean; data?: unknown; event?: LiveEventDto } | LiveEventDto
    >(`/api/live/events/${eventId}`, { signal });
    return normalizeEvent(extractEventPayload(response));
  },
  async getEventTickets(eventId, signal) {
    const event = normalizeEvent(
      await fetchEventDetailPayload(eventId, signal),
    );
    const tickets = Array.isArray(event.ticketDefinitions)
      ? event.ticketDefinitions
      : [];
    return {
      success: true,
      eventId,
      source: "event-detail",
      count: tickets.length,
      tickets,
    };
  },
  async getEventPartners(eventId, signal) {
    type PartnersPayload =
      | EventPartnersResponse
      | { success?: boolean; data?: EventPartnersResponse };
    const path = `/api/events/${eventId}/sponsors`;
    const options = { signal };

    let response: PartnersPayload;
    try {
      // Use the same public mobile origin as the working event-detail request.
      // The endpoint is no-store, so a request nonce and concurrent fetches are
      // unnecessary and can make native failures harder to recover from.
      response = await api.json<PartnersPayload>(path, options);
    } catch (mobileApiError) {
      try {
        response = await api.json<PartnersPayload>(
          `https://bergmantri.com${path}`,
          options,
        );
      } catch {
        try {
          // Restricted test events remain available to signed-in admins.
          response = await liveApi.json<PartnersPayload>(path, options);
        } catch {
          throw mobileApiError;
        }
      }
    }
    const payload: EventPartnersResponse =
      "data" in response && response.data && typeof response.data === "object"
        ? response.data
        : (response as EventPartnersResponse);
    const sponsors = (Array.isArray(payload.sponsors) ? payload.sponsors : [])
      .filter((sponsor) =>
        Boolean(toText(sponsor.name) && toText(sponsor.logoUrl)),
      )
      .map((sponsor, index) => ({
        id: toText(sponsor.id) ?? `${eventId}-sponsor-${index}`,
        name: toText(sponsor.name) ?? "Event Partner",
        logoUrl: toText(sponsor.logoUrl) ?? "",
        website: toText(sponsor.website) ?? null,
        type: toText(sponsor.type) ?? null,
        order: toNumber(sponsor.order) ?? index,
      }))
      .sort((a, b) => a.order - b.order);
    return {
      success: response.success !== false && payload.success !== false,
      eventId,
      count: sponsors.length,
      sponsors,
    };
  },
  async getEventCourseCutoffs(eventId, signal) {
    const event = normalizeEvent(
      await fetchEventDetailPayload(eventId, signal),
    );
    const contests = (
      Array.isArray(event.ticketDefinitions) ? event.ticketDefinitions : []
    )
      .map((entry, order) => {
        const contest = entry as Record<string, unknown>;
        return {
          contestUuid: firstText(
            contest.providerContestUuid,
            contest.contestUuid,
            contest.id,
          ),
          contestName: firstText(
            contest.contestName,
            contest.ticketName,
            contest.name,
          ),
          ticketName: firstText(contest.ticketName, contest.name),
          cutoffs:
            contest.cutoffs && typeof contest.cutoffs === "object"
              ? (contest.cutoffs as Record<string, unknown>)
              : null,
          subCategories: Array.isArray(contest.subCategories)
            ? contest.subCategories
            : null,
          order,
        } satisfies PublicContestCutoff;
      })
      .filter((contest) => Boolean(contest.cutoffs));
    return { success: true, eventId, contests };
  },
  async getEventRules(eventId, signal) {
    try {
      const res = await api.json<{
        html?: string | null;
        customRulesHtml?: string | null;
        rulesHtml?: string | null;
        regulationsHtml?: string | null;
        rulesAndRegulationsHtml?: string | null;
      }>(`/api/events/${eventId}/rules`, { signal });
      const html =
        firstText(
          res.html,
          res.customRulesHtml,
          res.rulesHtml,
          res.regulationsHtml,
          res.rulesAndRegulationsHtml,
        ) ?? null;
      void writeEventContentCache(eventId, { rulesHtml: html });
      return html;
    } catch (error) {
      if ((error as { status?: number }).status === 404) {
        return await readCachedRulesHtml(eventId);
      }
      const cached = await readCachedRulesHtml(eventId);
      if (cached) return cached;
      throw error;
    }
  },
  getEventTracking(eventId, signal) {
    return liveApi.json<EventTrackingResponse>(
      `/api/events/${eventId}/tracking`,
      { signal },
    );
  },
  async getActiveAnnouncement(signal) {
    const response = await api.json<unknown>("/api/announcements/active", {
      signal,
    });
    const announcements = extractAnnouncementsPayload(response);
    return (
      announcements.find((announcement) => announcement.isActive !== false) ??
      announcements[0] ??
      null
    );
  },
  async getPublicAnnouncements(role = "athlete", eventId = null, signal) {
    const key = `${role}:${eventId ?? ""}`;
    const now = Date.now();
    if (
      publicAnnouncementsCooldownUntil > now &&
      lastPublicAnnouncementsResponse?.key === key
    ) {
      return lastPublicAnnouncementsResponse.value;
    }

    const searchParams = new URLSearchParams();
    searchParams.set("role", role);
    if (eventId) searchParams.set("eventId", eventId);
    try {
      const res = await api.json<{
        success?: boolean;
        announcements?: ActiveAnnouncement[];
        count?: number;
        role?: string;
        eventId?: string | null;
      }>(`/api/public/announcements?${searchParams.toString()}`, { signal });
      const value = {
        announcements: Array.isArray(res.announcements)
          ? res.announcements
          : [],
        count:
          typeof res.count === "number"
            ? res.count
            : Array.isArray(res.announcements)
              ? res.announcements.length
              : 0,
        role: res.role || role,
        eventId: res.eventId ?? eventId,
      };
      lastPublicAnnouncementsResponse = { key, value };
      publicAnnouncementsCooldownUntil = 0;
      return value;
    } catch (error) {
      if ((error as { status?: number }).status === 429) {
        publicAnnouncementsCooldownUntil =
          Date.now() + PUBLIC_ANNOUNCEMENTS_COOLDOWN_MS;
        if (lastPublicAnnouncementsResponse?.key === key) {
          return lastPublicAnnouncementsResponse.value;
        }
        return {
          announcements: [],
          count: 0,
          role,
          eventId,
        };
      }
      throw error;
    }
  },
  async getHomepageSlider(signal) {
    const response = await api.json<{
      success?: boolean;
      items?: HomepageSliderItem[];
      data?: { items?: HomepageSliderItem[] };
    }>("/api/public/homepage-slider", { signal });
    const items = Array.isArray(response.items)
      ? response.items
      : Array.isArray(response.data?.items)
        ? response.data.items
        : [];
    return items.filter(
      (item) =>
        item &&
        item.showOnHomepage !== false &&
        Boolean(String(item.mobileSrc || item.src || "").trim()),
    );
  },
};
