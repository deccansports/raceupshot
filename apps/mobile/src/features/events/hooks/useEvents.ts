import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";

import { isDevelopment } from "@/core/constants/env";
import { useSession } from "@/core/auth/session";
import { repositories } from "@/core/repositories";
import { queryKeys } from "@/core/services/query/queryKeys";
import { queryClient } from "@/core/services/query/queryClient";
import type { LiveEventDto, RaceStatus } from "@/core/types";
import { safeRouteEventId } from "@/features/events/utils/eventRoute";

export type EventTab = "live" | "upcoming" | "completed";

export type LiveEventItem = {
  id: string;
  eventId?: string;
  name: string;
  dateLabel: string;
  updatedAt?: string;
  startDate?: string;
  startAt?: string;
  countdownTargetAt?: string;
  timezone?: string;
  endDate?: string;
  status: RaceStatus;
  isUpcoming: boolean;
  photoUrl?: string;
  logoUrl?: string;
  participantCount?: number;
  imageUri?: string;
  bannerImage?: string;
  bannerImageUrl?: string;
  coverImage?: string;
  coverImageUrl?: string;
  location?: string;
  discipline?: string;
  distances?: string;
  temperatureMetrics?: Record<string, unknown> | null;
  courseDetails?: Record<string, unknown> | null;
  liveTracking?: Record<string, unknown> | null;
  liveTrackingEnabled?: boolean;
  liveTrackingHub?: Record<string, unknown> | null;
  liveTrackingProviderState?: Record<string, unknown> | null;
  feibotConfig?: Record<string, unknown> | null;
  mapsSplitsConfig?: Record<string, unknown>[] | null;
  blocks?: { id?: string | null; html?: string | null }[] | null;
  customRules?: string | null;
  customRulesHtml?: string | null;
  customContent?: string | null;
  disciplineSchedule?: unknown;
  ticketDefinitions?: Record<string, unknown>[] | null;
  registrationUrl?: string;
  primaryCta?: {
    type?: string;
    label?: string;
    href?: string | null;
    disabled?: boolean;
  } | null;
  customSlug?: string;
  eventSlug?: string;
  cutoffMinutes?: number | null;
  cutoffs?: Record<string, unknown> | unknown[] | null;
  rulesUrl?: string | null;
  regulationsUrl?: string | null;
  rulesAndRegulationsUrl?: string | null;
  rulesHtml?: string | null;
  regulationsHtml?: string | null;
  rulesAndRegulationsHtml?: string | null;
  athleteGuidebookUrl?: string | null;
  athleteGuideBookUrl?: string | null;
  athleteGuideUrl?: string | null;
  athleteGuideBook?: string | null;
  guidebookUrl?: string | null;
  guideBookUrl?: string | null;
  guideUrl?: string | null;
  pdfUrl?: string | null;
  downloadUrl?: string | null;
  rulesContentHtml?: string | null;
  regulationsContentHtml?: string | null;
  raw?: Record<string, unknown>;
};

export type PublicContestCutoff = {
  contestUuid?: string | null;
  contestName?: string | null;
  cutoffs?: Record<string, unknown> | unknown[] | null;
  subCategories?: unknown[] | null;
  ticketName?: string | null;
  order?: number | null;
};

const TAB_STATUS: Record<EventTab, RaceStatus[]> = {
  live: ["live"],
  upcoming: ["upcoming", "notStarted"],
  completed: ["finished"],
};

function parseDate(value: string | null | undefined): Date | null {
  const candidate = value?.trim();
  if (!candidate) return null;
  const parsed = new Date(candidate);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isTbdDate(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const text = value.trim().toLowerCase();
  return (
    text.includes("tbd") ||
    text.includes("to be decided") ||
    text.includes("to-be-decided") ||
    text.includes("date tbd")
  );
}

function isTbdEvent(dto: LiveEventDto): boolean {
  const record = dto as Record<string, unknown>;
  const name = String(
    dto.eventName ?? dto.name ?? record.title ?? record.name ?? "",
  ).trim();
  return (
    isTbdDate(dto.date) ||
    isTbdDate(dto.eventDate) ||
    isTbdDate(dto.startAt) ||
    isTbdDate(dto.startDate) ||
    isTbdDate(dto.endDate) ||
    isTbdDate(dto.dateRange) ||
    isTbdDate(dto.displayDateRange) ||
    isTbdDate(dto.displayDate) ||
    isTbdDate(dto.dateLabel) ||
    isTbdDate(record.rawDate as unknown) ||
    isTbdDate(
      record.date ??
        record.eventDate ??
        record.startsAt ??
        record.startAt ??
        record.startDate,
    ) ||
    isTbdDate(name) ||
    /tbd|to be decided|to-be-decided/i.test(name)
  );
}

function joinLocation(
  parts: (string | null | undefined)[],
): string | undefined {
  const values = parts
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value))
    .filter(
      (value) =>
        !/^(?:visibility[_ -]?disabled|visibility[_ -]?enabled|enabled|disabled)$/i.test(
          value,
        ),
    );
  return values.length > 0 ? values.join(" · ") : undefined;
}

function sanitizeEventLocation(
  value: string | null | undefined,
): string | undefined {
  const parts = String(value ?? "")
    .split(/\s*·\s*/)
    .map((part) => part.trim())
    .filter(Boolean)
    .filter(
      (part) =>
        !/^(?:visibility[_ -]?disabled|visibility[_ -]?enabled|enabled|disabled)$/i.test(
          part,
        ),
    );
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

function firstText(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function firstDefined<T>(...values: (T | null | undefined)[]): T | undefined {
  for (const value of values) {
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

function collectTextValues(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectTextValues(item));
  }
  if (typeof value === "string" && value.trim()) {
    return [value.trim()];
  }
  return [];
}

function formatSingleDate(date: Date): string {
  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatDateRangeLabel(start: Date, end: Date): string {
  const sameYear = start.getFullYear() === end.getFullYear();
  const sameMonth = sameYear && start.getMonth() === end.getMonth();
  if (sameMonth) {
    return `${start.getDate()}–${end.getDate()} ${start.toLocaleDateString(undefined, { month: "short", year: "numeric" })}`;
  }
  if (sameYear) {
    return `${formatSingleDate(start)} – ${end.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}`;
  }
  return `${formatSingleDate(start)} – ${formatSingleDate(end)}`;
}

function formatEventDateLabel(dto: LiveEventDto): string {
  const record = dto as Record<string, unknown>;
  const courseDetails =
    dto.courseDetails && typeof dto.courseDetails === "object"
      ? (dto.courseDetails as Record<string, unknown>)
      : undefined;

  const explicitLabel = firstText(
    record.displayDateRange,
    record.displayDate,
    record.dateRange,
    courseDetails?.displayDateRange,
    courseDetails?.displayDate,
  );
  if (explicitLabel) return explicitLabel;

  const rawValues = [
    record.displayDateRange,
    record.displayDate,
    record.dateRange,
    dto.eventDate,
    dto.date,
    record.dateLabel,
    record.startDate,
    record.endDate,
    record.dateStart,
    record.dateEnd,
    record.ticketDate,
    record.ticketDates,
    record.ticketEventDate,
    record.ticketEventDates,
    record.ticketCategoryDate,
    record.ticketCategoryDates,
    record.eventDates,
    courseDetails?.ticketDate,
    courseDetails?.ticketDates,
    courseDetails?.eventDate,
    courseDetails?.eventDates,
    ...(
      (Array.isArray(record.disciplineSchedule)
        ? record.disciplineSchedule
        : []) as unknown[]
    ).flatMap((item) => {
      if (typeof item === "string") return [item];
      if (!item || typeof item !== "object") return [];
      const row = item as Record<string, unknown>;
      return collectTextValues(row.date ?? row.eventDate ?? row.raceDate);
    }),
    ...(
      (Array.isArray(record.ticketDefinitions)
        ? record.ticketDefinitions
        : []) as unknown[]
    ).flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const row = item as Record<string, unknown>;
      return collectTextValues(
        row.eventDate ?? row.raceDate ?? row.ticketEventDate ?? row.date,
      );
    }),
  ];

  const parsedDates = rawValues
    .flatMap((value) => collectTextValues(value))
    .map((value) => parseDate(value))
    .filter((value): value is Date => Boolean(value))
    .map(
      (value) =>
        new Date(value.getFullYear(), value.getMonth(), value.getDate()),
    )
    .filter(
      (date, index, list) =>
        list.findIndex((item) => item.getTime() === date.getTime()) === index,
    )
    .sort((a, b) => a.getTime() - b.getTime());

  if (parsedDates.length >= 2) {
    return formatDateRangeLabel(
      parsedDates[0],
      parsedDates[parsedDates.length - 1],
    );
  }

  if (parsedDates.length === 1) {
    return formatSingleDate(parsedDates[0]);
  }

  return firstText(...rawValues) ?? "";
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function parseSortDate(value: string | null | undefined): number | null {
  const text = value?.trim();
  if (!text) return null;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
}

function getEventSortTime(event: LiveEventItem, tab: EventTab): number {
  if (tab === "upcoming" && isTbdEvent(event as LiveEventDto)) {
    return Number.POSITIVE_INFINITY;
  }
  const fallback =
    tab === "upcoming" ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
  return (
    parseSortDate(event.startAt) ??
    parseSortDate(event.countdownTargetAt) ??
    parseSortDate(event.startDate) ??
    parseSortDate(event.endDate) ??
    parseSortDate(event.raw?.startsAt as string | undefined) ??
    parseSortDate(event.raw?.startAt as string | undefined) ??
    parseSortDate(event.dateLabel) ??
    parseSortDate(event.raw?.eventDate as string | undefined) ??
    parseSortDate(event.raw?.date as string | undefined) ??
    fallback
  );
}

/** Orders scheduled events chronologically, keeping undated/TBD events last. */
export function compareUpcomingEvents(
  a: LiveEventItem,
  b: LiveEventItem,
): number {
  const aTbd = isTbdEvent(a as LiveEventDto);
  const bTbd = isTbdEvent(b as LiveEventDto);
  if (aTbd !== bTbd) return aTbd ? 1 : -1;

  const dateOrder =
    getEventSortTime(a, "upcoming") - getEventSortTime(b, "upcoming");
  if (Number.isFinite(dateOrder) && dateOrder !== 0) return dateOrder;

  return a.name.localeCompare(b.name);
}

function sortEvents(events: LiveEventItem[], tab: EventTab): LiveEventItem[] {
  const copy = [...events];

  copy.sort((a, b) => {
    if (tab === "upcoming") {
      const aTbd = isTbdEvent(a as LiveEventDto);
      const bTbd = isTbdEvent(b as LiveEventDto);
      if (aTbd !== bTbd) return aTbd ? 1 : -1;
    }

    const aTime = getEventSortTime(a, tab);
    const bTime = getEventSortTime(b, tab);

    if (tab === "completed") {
      return bTime - aTime;
    }

    if (tab === "upcoming") {
      return compareUpcomingEvents(a, b);
    }

    if (tab === "live") {
      return aTime - bTime;
    }

    return 0;
  });

  return copy;
}

function toStatus(dto: LiveEventDto): RaceStatus {
  const s = (dto.status ?? "").toLowerCase();
  const record = dto as Record<string, unknown>;
  const section = String(record.section ?? "").trim().toLowerCase();
  const lifecycleStatus = String(record.lifecycleStatus ?? "").trim().toLowerCase();
  const name = String(dto.eventName ?? dto.name ?? "")
    .trim()
    .toLowerCase();
  const now = Date.now();
  const startDate = parseDate(
    dto.startAt ?? (record.startsAt as string | undefined) ?? dto.startDate ?? dto.dateStart ?? dto.eventDate ?? dto.date,
  );
  const endDate = parseDate((record.endsAt as string | undefined) ?? dto.endDate ?? dto.dateEnd);
  const lifecycleBaseline = endDate ?? startDate;
  const pastAt = lifecycleBaseline ? lifecycleBaseline.getTime() + 24 * 60 * 60 * 1000 : null;

  if (
    isTbdEvent(dto) ||
    isTbdDate(dto.status) ||
    /tbd|to be decided|to-be-decided/.test(name)
  )
    return "upcoming";

  if (
    lifecycleStatus.includes("complete") ||
    lifecycleStatus.includes("finish") ||
    lifecycleStatus.includes("result") ||
    lifecycleStatus.includes("archiv")
  ) {
    return "finished";
  }
  if (pastAt !== null && now >= pastAt && (section === "live" || lifecycleStatus.includes("live") || lifecycleStatus.includes("paused"))) return "finished";
  if (section === "past") return "finished";
  if (section === "live") return "live";
  if (section === "upcoming") return "upcoming";
  if (lifecycleStatus.includes("live") || lifecycleStatus.includes("paused")) {
    if (pastAt === null || now < pastAt) return "live";
  }

  // The event-list APIs already resolve race-day and multi-day schedules into
  // a live status. Honour that before comparing date-only values, which parse
  // at midnight and would otherwise make a live race look finished all day.
  if (
    s.includes("live") ||
    s.includes("ongoing") ||
    s.includes("in progress") ||
    s.includes("in_progress") ||
    s.includes("in-progress") ||
    s.includes("started") ||
    s.includes("running")
  ) {
    return pastAt !== null && now >= pastAt ? "finished" : "live";
  }

  if (startDate && now < startDate.getTime()) {
    return "upcoming";
  }
  if (pastAt !== null && now >= pastAt) {
    return "finished";
  }
  if (startDate && now >= startDate.getTime()) return "live";

  if (
    s.includes("finish") ||
    s.includes("complete") ||
    s.includes("done") ||
    s.includes("closed") ||
    s.includes("ended") ||
    s.includes("result")
  ) {
    if (pastAt !== null && now < pastAt) return "live";
    return "finished";
  }

  const eventDate = parseDate(dto.eventDate ?? dto.date);
  if (eventDate) {
    if (eventDate.getTime() + 24 * 60 * 60 * 1000 <= now) return "finished";
    if (eventDate.getTime() <= now) return "live";
    return "upcoming";
  }

  if (!eventDate && !startDate && !endDate) {
    if (
      s.includes("tbd") ||
      name.includes("tbd") ||
      name.includes("to be decided")
    ) {
      return "upcoming";
    }
    return "upcoming";
  }

  if (
    dto.isUpcoming ||
    s.includes("upcoming") ||
    s.includes("start") ||
    s.includes("scheduled") ||
    s.includes("show") ||
    s.includes("open")
  ) {
    return "upcoming";
  }
  return "notStarted";
}

function isMockEvent(event: LiveEventItem): boolean {
  const name = event.name?.trim().toLowerCase() ?? "";
  const eventId = event.id?.trim().toLowerCase() ?? "";
  const raw = event.raw as Record<string, unknown> | undefined;
  const isAdminOnly = raw?.adminOnly === true || raw?.isAdminOnly === true;
  const looksLikeRandomId =
    eventId.length >= 16 && /^[a-z0-9]+$/i.test(eventId);
  const looksLikeEventPrefix =
    name === "event" || /^event\s+[a-z0-9_-]+$/i.test(name);
  const isKnownPublicTestName =
    !isAdminOnly &&
    (eventId.startsWith("test-") ||
      /smoke[-\s]?test/.test(name) ||
      name.startsWith("sbx") ||
      /event\s+triathlon/i.test(name));

  return (
    looksLikeEventPrefix ||
    isKnownPublicTestName ||
    (name.startsWith("event ") &&
      looksLikeRandomId &&
      event.location === undefined)
  );
}

function mapEvent(dto: LiveEventDto): LiveEventItem {
  const distances = Array.isArray(dto.distances)
    ? dto.distances.join(" · ")
    : dto.distances;
  const dateLabel = formatEventDateLabel(dto);
  const record = dto as Record<string, unknown>;
  const courseDetails =
    dto.courseDetails && typeof dto.courseDetails === "object"
      ? (dto.courseDetails as Record<string, unknown>)
      : undefined;
  const media =
    courseDetails?.media && typeof courseDetails.media === "object"
      ? (courseDetails.media as Record<string, unknown>)
      : undefined;
  const temperatureMetrics = (dto.temperatureMetrics ??
    record.temperatureMetrics ??
    null) as Record<string, unknown> | null;
  const courseDetailsValue = (dto.courseDetails ??
    record.courseDetails ??
    null) as Record<string, unknown> | null;
  const liveTracking = (dto.liveTracking ??
    record.liveTracking ??
    null) as Record<string, unknown> | null;
  const liveTrackingHub = (record.liveTrackingHub ??
    (dto as Record<string, unknown>).liveTrackingHub ??
    null) as Record<string, unknown> | null;
  const liveTrackingProviderState = (dto.liveTrackingProviderState ??
    record.liveTrackingProviderState ??
    null) as Record<string, unknown> | null;
  const feibotConfig = (record.feibotConfig ??
    (dto as Record<string, unknown>).feibotConfig ??
    null) as Record<string, unknown> | null;
  const mapsSplitsConfig = (record.mapsSplitsConfig ??
    (dto as Record<string, unknown>).mapsSplitsConfig ??
    null) as Record<string, unknown>[] | null;
  const ticketDefinitions = Array.isArray(record.ticketDefinitions)
    ? (record.ticketDefinitions as Record<string, unknown>[])
    : Array.isArray((dto as Record<string, unknown>).ticketDefinitions)
      ? ((dto as Record<string, unknown>).ticketDefinitions as Record<
          string,
          unknown
        >[])
      : null;
  const cutoffs =
    firstDefined(dto.cutoffs, courseDetails?.cutoffs, record.cutoffs) ?? null;
  const updatedAt = firstText(
    (dto as Record<string, unknown>).updatedAt,
    record.updatedAt,
    record.updated_at,
  );
  const athleteGuidebookUrl =
    firstText(
      (dto as Record<string, unknown>).athleteGuidebookUrl,
      (dto as Record<string, unknown>).athleteGuideBookUrl,
      (dto as Record<string, unknown>).athleteGuideUrl,
      (dto as Record<string, unknown>).guidebookUrl,
      (dto as Record<string, unknown>).guideBookUrl,
      (dto as Record<string, unknown>).guideUrl,
      (dto as Record<string, unknown>).pdfUrl,
      (dto as Record<string, unknown>).downloadUrl,
      courseDetails?.athleteGuidebookUrl,
      courseDetails?.athleteGuideBookUrl,
      courseDetails?.athleteGuideUrl,
      courseDetails?.guidebookUrl,
      courseDetails?.guideBookUrl,
      courseDetails?.guideUrl,
      courseDetails?.pdfUrl,
      courseDetails?.downloadUrl,
    ) ?? null;
  const fallbackId = String(
    firstText(
      dto.id,
      dto.eventId,
      (dto as Record<string, unknown>).event_id,
      (dto as Record<string, unknown>).docId,
      (dto as Record<string, unknown>).slug,
    ) ?? "",
  );
  const domainEvent = {
    id: fallbackId,
    eventId: dto.eventId ?? fallbackId,
    name: dto.eventName ?? dto.name,
    dateLabel,
    updatedAt,
    startDate:
      firstText(
        dto.startAt,
        dto.startDate,
        dto.dateStart,
        dto.eventDate,
        dto.date,
        record.startsAt,
        record.startAt,
        record.startDate,
        record.dateStart,
        record.eventDate,
      ) || undefined,
    startAt:
      firstText(dto.startAt, record.startAt, record.startsAt) || undefined,
    countdownTargetAt:
      firstText(dto.countdownTargetAt, record.countdownTargetAt) || undefined,
    timezone: firstText(dto.timezone, record.timezone) || undefined,
    endDate:
      firstText(
        dto.endDate,
        dto.dateEnd,
        record.endsAt,
        record.endAt,
        record.endDate,
        record.dateEnd,
        record.eventEndDate,
        record.displayEndDate,
      ) || undefined,
    status: toStatus(dto),
    isUpcoming: dto.isUpcoming ?? toStatus(dto) === "upcoming",
    imageUri:
      firstText(
        dto.photoUrl,
        dto.imageUri,
        dto.imageUrl,
        record.bannerUrl,
        dto.bannerImage,
        dto.bannerImageUrl,
        dto.coverImage,
        dto.coverImageUrl,
        record.posterImageUrl,
        record.posterUrl,
        record.heroImageUrl,
        record.thumbnailUrl,
        record.eventImage,
        record.eventImageUrl,
        record.photo,
        record.logoUrl,
        courseDetails?.photoUrl,
        courseDetails?.imageUri,
        courseDetails?.imageUrl,
        courseDetails?.bannerUrl,
        courseDetails?.bannerImageUrl,
        courseDetails?.coverImageUrl,
        media?.hero,
        media?.banner,
        media?.cover,
        media?.thumbnail,
      ) ?? undefined,
    photoUrl:
      firstText(
        dto.photoUrl,
        record.photoUrl,
        dto.imageUrl,
        record.imageUrl,
        courseDetails?.photoUrl,
      ) ?? undefined,
    logoUrl:
      firstText(
        dto.logoUrl,
        record.logoUrl,
        courseDetails?.logoUrl,
      ) ?? undefined,
    participantCount: Number(
      firstText(
        (dto as Record<string, unknown>).participantCount,
        (dto as Record<string, unknown>).participants,
        record.participantCount,
        record.participants,
      ) ?? 0,
    ) || undefined,
    bannerImage:
      firstText(
        dto.bannerImage,
        record.bannerImage,
        courseDetails?.bannerImage,
        media?.banner,
      ) ?? undefined,
    bannerImageUrl:
      firstText(
        dto.bannerImageUrl,
        record.bannerImageUrl,
        courseDetails?.bannerImageUrl,
        media?.banner,
      ) ?? undefined,
    coverImage:
      firstText(
        dto.coverImage,
        record.coverImage,
        courseDetails?.coverImage,
        media?.cover,
      ) ?? undefined,
    coverImageUrl:
      firstText(
        dto.coverImageUrl,
        record.coverImageUrl,
        courseDetails?.coverImageUrl,
        media?.cover,
      ) ?? undefined,
    location:
      sanitizeEventLocation(dto.location) ??
      joinLocation([dto.venueName, dto.address, dto.state, dto.country]) ??
      undefined,
    discipline: dto.discipline ?? undefined,
    distances: distances ?? undefined,
    temperatureMetrics,
    courseDetails: courseDetailsValue,
    liveTracking,
    liveTrackingEnabled:
      typeof dto.liveTrackingEnabled === "boolean"
        ? dto.liveTrackingEnabled
        : typeof record.liveTrackingEnabled === "boolean"
          ? record.liveTrackingEnabled
          : typeof liveTracking?.enabled === "boolean"
            ? liveTracking.enabled
            : false,
    liveTrackingHub,
    liveTrackingProviderState,
    feibotConfig,
    mapsSplitsConfig,
    ticketDefinitions,
    registrationUrl: firstText(record.registrationUrl) ?? undefined,
    primaryCta:
      record.primaryCta && typeof record.primaryCta === "object"
        ? (record.primaryCta as LiveEventItem["primaryCta"])
        : null,
    customSlug:
      firstText(dto.customSlug, record.customSlug, record.slug) ?? undefined,
    eventSlug:
      firstText(dto.eventSlug, record.eventSlug, record.event_slug) ??
      undefined,
    blocks: Array.isArray((dto as Record<string, unknown>).blocks)
      ? ((dto as Record<string, unknown>).blocks as {
          id?: string | null;
          html?: string | null;
        }[])
      : Array.isArray(record.blocks)
        ? (record.blocks as { id?: string | null; html?: string | null }[])
        : null,
    customRules:
      firstText(
        dto.customRules,
        record.customRules,
        record.customRulesHtml,
        record.customRules as string | undefined,
      ) ?? null,
    customRulesHtml:
      firstText(
        dto.customRulesHtml,
        dto.customRules,
        record.customRulesHtml,
        record.customRules,
      ) ?? null,
    customContent:
      firstText(
        (dto as Record<string, unknown>).customContent,
        (dto as Record<string, unknown>).customContentHtml,
        record.customContent,
        record.customContentHtml,
      ) ?? null,
    disciplineSchedule: (record.disciplineSchedule ??
      (dto as Record<string, unknown>).disciplineSchedule ??
      null) as unknown,
    cutoffMinutes: toNumber(
      firstDefined(
        dto.cutoffMinutes,
        courseDetails?.cutoffMinutes,
        record.cutoffMinutes,
      ),
    ),
    cutoffs: (cutoffs as Record<string, unknown> | unknown[] | null) ?? null,
    rulesUrl:
      dto.rulesUrl ?? dto.rulesAndRegulationsUrl ?? dto.regulationsUrl ?? null,
    regulationsUrl:
      dto.regulationsUrl ?? dto.rulesAndRegulationsUrl ?? dto.rulesUrl ?? null,
    rulesAndRegulationsUrl:
      dto.rulesAndRegulationsUrl ?? dto.rulesUrl ?? dto.regulationsUrl ?? null,
    rulesHtml:
      firstText(dto.rulesHtml, courseDetails?.rulesHtml, record.rulesHtml) ??
      null,
    regulationsHtml:
      firstText(
        dto.regulationsHtml,
        courseDetails?.regulationsHtml,
        record.regulationsHtml,
      ) ?? null,
    rulesAndRegulationsHtml:
      firstText(
        dto.rulesAndRegulationsHtml,
        courseDetails?.rulesAndRegulationsHtml,
        record.rulesAndRegulationsHtml,
      ) ?? null,
    athleteGuidebookUrl,
    athleteGuideBookUrl:
      firstText(
        (dto as Record<string, unknown>).athleteGuideBookUrl,
        athleteGuidebookUrl,
      ) ?? null,
    athleteGuideUrl: athleteGuidebookUrl,
    guidebookUrl: athleteGuidebookUrl,
    guideUrl: athleteGuidebookUrl,
    pdfUrl:
      firstText(
        (dto as Record<string, unknown>).pdfUrl,
        (dto as Record<string, unknown>).downloadUrl,
        courseDetails?.pdfUrl,
        courseDetails?.downloadUrl,
      ) ?? null,
    downloadUrl:
      firstText(
        (dto as Record<string, unknown>).downloadUrl,
        (dto as Record<string, unknown>).pdfUrl,
        courseDetails?.downloadUrl,
        courseDetails?.pdfUrl,
      ) ?? null,
    rulesContentHtml:
      firstText(
        dto.rulesContentHtml,
        courseDetails?.rulesContentHtml,
        record.rulesContentHtml,
      ) ?? null,
    regulationsContentHtml:
      firstText(
        dto.regulationsContentHtml,
        courseDetails?.regulationsContentHtml,
        record.regulationsContentHtml,
      ) ?? null,
    raw: (record.raw as Record<string, unknown> | undefined) ?? record,
  };

  return {
    ...domainEvent,
  };
}

/** Events from the Mobile API Worker aggregate (GET /api/events). */
export function useEvents() {
  const sessionStatus = useSession((state) => state.status);
  const sessionUserId = useSession((state) => state.user?.uid ?? null);
  const eventListScope = sessionUserId
    ? `authenticated:${sessionUserId}`
    : "public";
  const query = useQuery({
    queryKey: queryKeys.events.scopedList(eventListScope),
    queryFn: ({ signal }) =>
      repositories.events.getLiveEvents(signal, {
        preferNetwork: sessionStatus === "authenticated",
        cacheScope: eventListScope,
      }),
    staleTime: 60_000,
    refetchInterval: 60_000,
    refetchOnMount: true,
    refetchOnReconnect: true,
    // A request made while Firebase is still restoring the session is a public
    // request and cannot contain admin-only events. Wait until the auth state is
    // known before loading the shared event list.
    enabled: sessionStatus !== "loading",
  });
  const safeEvents = Array.isArray(query.data) ? query.data : [];
  const events = safeEvents
    .reduce<LiveEventItem[]>((acc, event) => {
      try {
        return [...acc, mapEvent(event)];
      } catch (error) {
        if (isDevelopment) {
          console.log("[events] Failed to map event", {
            error: error instanceof Error ? error.message : "Unknown error",
            eventId: event.id ?? event.eventId ?? null,
          });
        }
        return acc;
      }
    }, [])
    .filter((event) => !isMockEvent(event));

  return {
    events,
    isLoading: query.isLoading,
    // Keep successfully cached events visible if only a background refresh fails.
    isError: query.isError && events.length === 0,
    isRefreshing: query.isRefetching,
    refetch: query.refetch,
  };
}

/** Filters live events by tab + free-text search (name). */
export function selectEvents(
  events: LiveEventItem[],
  tab: EventTab,
  search: string,
): LiveEventItem[] {
  const q = search.trim().toLowerCase();
  const filtered = events.filter(
    (e) =>
      TAB_STATUS[tab].includes(e.status) &&
      (q.length === 0 || e.name.toLowerCase().includes(q)),
  );

  return sortEvents(filtered, tab);
}

/** Complete event details from the mobile backend aggregate. */
export function useEvent(eventId: string) {
  const sessionUserId = useSession((state) => state.user?.uid ?? null);
  const eventListScope = sessionUserId
    ? `authenticated:${sessionUserId}`
    : "public";
  const normalizedEventId = safeRouteEventId(eventId) ?? "";
  const validEventId = Boolean(normalizedEventId);
  const listEvents =
    queryClient.getQueryData<LiveEventItem[]>(
      queryKeys.events.scopedList(eventListScope),
    ) ?? [];
  const cachedEvent = listEvents.find(
    (event) => safeRouteEventId(event.eventId, event.id) === normalizedEventId,
  );
  const query = useQuery({
    queryKey: queryKeys.events.detail(
      validEventId ? normalizedEventId : "route-inactive",
    ),
    queryFn: async ({ signal }) => {
      if (!validEventId) throw new Error("EVENT_ID_REQUIRED");
      return await repositories.events.getEventDetail(
        normalizedEventId,
        signal,
      );
    },
    select: mapEvent,
    placeholderData: cachedEvent as LiveEventDto | undefined,
    staleTime: 5 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    enabled: validEventId,
  });
  useEffect(() => {
    if (isDevelopment && validEventId && query.error) {
      console.error("[events] Failed to load event detail", {
        eventId: normalizedEventId,
        error:
          query.error instanceof Error ? query.error.message : "Unknown error",
      });
    }
  }, [query.error, normalizedEventId, validEventId]);
  useEffect(() => {
    if (isDevelopment && query.data) {
      const blocksLength = Array.isArray(query.data.blocks)
        ? query.data.blocks.length
        : 0;
      const customRulesLength =
        query.data.customRules?.length ??
        query.data.customRulesHtml?.length ??
        0;
      console.log("[event-details]", {
        eventId: query.data.eventId ?? query.data.id,
        eventName: query.data.name,
        ticketCount: query.data.ticketDefinitions?.length ?? 0,
        blocksLength,
        rulesAvailable: customRulesLength > 0,
      });
    }
  }, [query.data]);
  return {
    event: validEventId ? query.data : undefined,
    isLoading: validEventId && query.isLoading,
    isError: validEventId && query.isError,
    error: validEventId ? query.error : null,
    refetch: query.refetch,
  };
}

export function useEventPartners(eventId: string, enabled = true) {
  const normalizedEventId = safeRouteEventId(eventId) ?? "";
  const validEventId = Boolean(normalizedEventId);
  return useQuery({
    queryKey: queryKeys.events.partners(
      validEventId ? normalizedEventId : "disabled",
    ),
    queryFn: ({ signal }) => {
      if (!validEventId) throw new Error("EVENT_ID_REQUIRED");
      return repositories.events.getEventPartners(normalizedEventId, signal);
    },
    // Public event partners must not wait for Firebase session restoration or
    // restart when that session moves from loading to guest/authenticated.
    enabled: enabled && validEventId,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    retry: 1,
  });
}

export function useEventLive(eventId: string, enabled = true) {
  const normalizedEventId = safeRouteEventId(eventId) ?? "";
  const validEventId = Boolean(normalizedEventId);
  return useQuery({
    queryKey: queryKeys.events.live(
      validEventId ? normalizedEventId : "disabled",
    ),
    queryFn: async ({ signal }) => {
      if (!validEventId) throw new Error("EVENT_ID_REQUIRED");
      return repositories.events.getEventLiveSummary(normalizedEventId, signal);
    },
    retry: false,
    staleTime: 60_000,
    enabled: enabled && validEventId,
  });
}

export function useEventCourseIndex(eventId: string, enabled = true) {
  const normalizedEventId = safeRouteEventId(eventId) ?? "";
  const validEventId = Boolean(normalizedEventId);
  return useQuery({
    queryKey: queryKeys.events.courseIndex(
      validEventId ? normalizedEventId : "disabled",
    ),
    queryFn: async ({ signal }) => {
      if (!validEventId) throw new Error("EVENT_ID_REQUIRED");
      try {
        return await repositories.course.getCourseIndex(
          normalizedEventId,
          signal,
        );
      } catch (error) {
        if ((error as { status?: number } | undefined)?.status === 404) {
          if (isDevelopment) {
            console.log("[event-course-index] using ticket course fallback", {
              eventId: normalizedEventId,
            });
          }
          return null;
        }
        throw error;
      }
    },
    retry: false,
    staleTime: 5 * 60_000,
    enabled: enabled && validEventId,
  });
}

export function useEventCourseCutoffs(eventId: string, enabled = true) {
  const normalizedEventId = safeRouteEventId(eventId) ?? "";
  const validEventId = Boolean(normalizedEventId);
  return useQuery({
    queryKey: [
      ...queryKeys.events.courseIndex(
        validEventId ? normalizedEventId : "disabled",
      ),
      "public-cutoffs",
    ] as const,
    queryFn: async ({ signal }) => {
      if (!validEventId) throw new Error("EVENT_ID_REQUIRED");
      try {
        return await repositories.events.getEventCourseCutoffs(
          normalizedEventId,
          signal,
        );
      } catch (error) {
        if ((error as { status?: number } | undefined)?.status === 404) {
          return null;
        }
        throw error;
      }
    },
    retry: false,
    staleTime: 5 * 60_000,
    enabled: enabled && validEventId,
  });
}
