import {
  Linking,
  Modal as RNModal,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { getCountdownParts } from "@bergman/live-tracking-contracts/countdown";

import { useTheme } from "@/core/theme";
import { formatCutoffSummary, normalizeHtmlContent } from "@/core/utils";
import { queryKeys } from "@/core/services/query/queryKeys";
import { repositories } from "@/core/repositories";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Icon,
  Modal,
  Skeleton,
  Text,
} from "@/shared/components";

import { EventHtmlContent, shouldUseWebView } from "./EventHtmlContent";
import { useEvent, useEventCourseCutoffs } from "../hooks/useEvents";
import { resolveValidGuidebook } from "../utils/guidebook";
import { safeRouteEventId } from "../utils/eventRoute";

const eventPlaceholder = require("../../../../assets/images/event-placeholder.jpg");

function textValue(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function firstTextValue(...values: unknown[]): string | undefined {
  for (const value of values) {
    const text = textValue(value);
    if (text) return text;
  }
  return undefined;
}

function firstHtmlValue(...values: unknown[]): string | undefined {
  for (const value of values) {
    const html = normalizeHtmlContent(value);
    if (html) return html;
  }
  return undefined;
}

function formatCutoffTime(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function formatCutoffLabel(value: unknown): string {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "Contest";
}

function formatContestCutoffGroups(contests: unknown): {
  id: string;
  label: string;
  order?: number;
  cutoffs: { label: string; value: string }[];
  subCategories: {
    id: string;
    name: string;
    cutoff?: string;
    ageGroups: string[];
  }[];
}[] {
  if (!Array.isArray(contests)) return [];
  return contests
    .map((contest, index) => {
      if (!contest || typeof contest !== "object") return null;
      const record = contest as Record<string, unknown>;
      const subCategories = Array.isArray(record.subCategories)
        ? record.subCategories
            .map((item, subIndex) => {
              if (!item || typeof item !== "object") return null;
              const row = item as Record<string, unknown>;
              return {
                id:
                  firstTextValue(
                    row.id,
                    row.subCategoryId,
                    row.key,
                    row.slug,
                  ) ?? `sub-${index}-${subIndex}`,
                name:
                  firstTextValue(row.name, row.label, row.title) ??
                  "Sub category",
                cutoff: formatCutoffTime(
                  firstTextValue(row.cutoff, row.cutoffHHMMSS, row.cutoffTime),
                ),
                ageGroups: asTextArray(row.applicableAgeGroups),
              };
            })
            .filter(
              (
                value,
              ): value is {
                id: string;
                name: string;
                cutoff: string | undefined;
                ageGroups: string[];
              } => Boolean(value),
            )
        : [];
      const cutoffValue =
        record.cutoffs &&
        typeof record.cutoffs === "object" &&
        !Array.isArray(record.cutoffs)
          ? (record.cutoffs as Record<string, unknown>)
          : null;
      const overallCutoff = formatCutoffTime(
        firstTextValue(
          record.cutoffHHMMSS,
          record.cutoffTime,
          record.cutoff,
          record.cumulativeCutoffTime,
          record.cumulativeCutoff,
        ),
      );
      const cutoffs = [
        ...(overallCutoff ? [{ label: "Overall", value: overallCutoff }] : []),
        ...(cutoffValue
          ? [
              ...["swim", "bike", "run"]
                .map((key) => {
                  const value = formatCutoffTime(cutoffValue[key]);
                  return value ? { label: key.toUpperCase(), value } : null;
                })
                .filter((value): value is { label: string; value: string } =>
                  Boolean(value),
                ),
            ]
          : []),
      ];
      return {
        id:
          firstTextValue(
            record.contestUuid,
            record.id,
            record.ticketId,
            record.slug,
          ) ?? `contest-${index}`,
        label: formatCutoffLabel(
          firstTextValue(record.contestName, record.ticketName, record.name),
        ),
        order:
          typeof record.order === "number" && Number.isFinite(record.order)
            ? record.order
            : undefined,
        cutoffs,
        subCategories,
      };
    })
    .filter(
      (
        value,
      ): value is {
        id: string;
        label: string;
        order: number | undefined;
        cutoffs: { label: string; value: string }[];
        subCategories: {
          id: string;
          name: string;
          cutoff: string | undefined;
          ageGroups: string[];
        }[];
      } => Boolean(value),
    )
    .sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
}

function formatAirport(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  return firstTextValue(
    record.name,
    record.code,
    record.iata,
    record.iataCode,
    record.label,
    record.title,
    record.airport,
  );
}

function formatCountdownParts(
  dateLabel: string,
  now = Date.now(),
):
  | { days: string; hours: string; minutes: string; seconds: string }
  | undefined {
  const value = getCountdownParts(dateLabel, now);
  if (!value.valid || value.isPast) return undefined;

  return {
    days: String(value.days), hours: String(value.hours),
    minutes: String(value.minutes), seconds: String(value.seconds),
  };
}

function formatTemperature(
  metrics: Record<string, unknown> | null | undefined,
): string | undefined {
  if (!metrics) return undefined;
  const summary = firstTextValue(
    metrics.summary,
    metrics.label,
    metrics.description,
  );
  if (summary) return summary;

  const air = firstTextValue(
    metrics.airTemperature,
    metrics.air,
    metrics.highAirTemp,
    metrics.temperature,
    metrics.currentTemperature,
  );
  const water = firstTextValue(
    metrics.waterTemperature,
    metrics.water,
    metrics.avgWaterTemp,
    metrics.lowWaterTemp,
  );
  const range = firstTextValue(metrics.low, metrics.high, metrics.feelsLike);
  const parts = [
    air ? `Air ${air}` : undefined,
    water ? `Water ${water}` : undefined,
    range ? range : undefined,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

function formatTemperatureRows(
  metrics: Record<string, unknown> | null | undefined,
): { label: string; value: string }[] {
  if (!metrics) return [];
  const rows = [
    {
      label: "High Air Temperature",
      value: firstTextValue(
        metrics.highAirTemperature,
        metrics.highAirTemp,
        metrics.airHigh,
        metrics.maxAirTemperature,
        metrics.airTemperatureHigh,
      ),
    },
    {
      label: "Low Air Temperature",
      value: firstTextValue(
        metrics.lowAirTemperature,
        metrics.lowAirTemp,
        metrics.airLow,
        metrics.minAirTemperature,
        metrics.airTemperatureLow,
      ),
    },
    {
      label: "Average Water Temperature",
      value: firstTextValue(
        metrics.averageWaterTemperature,
        metrics.avgWaterTemperature,
        metrics.waterAverage,
        metrics.waterTemperature,
        metrics.avgWaterTemp,
      ),
    },
  ].filter((row): row is { label: string; value: string } =>
    Boolean(row.value),
  );
  return rows;
}

function formatCourseProfile(
  courseDetails: Record<string, unknown> | null | undefined,
): { label: string; value: string }[] {
  if (!courseDetails) return [];
  const profile = firstTextValue(
    courseDetails.courseProfile,
    courseDetails.summary,
    courseDetails.description,
    courseDetails.profile,
  );
  const swim = firstTextValue(
    courseDetails.swim,
    courseDetails.swimProfile,
    courseDetails.swimCourse,
  );
  const bike = firstTextValue(
    courseDetails.bike,
    courseDetails.bikeProfile,
    courseDetails.bikeCourse,
  );
  const run = firstTextValue(
    courseDetails.run,
    courseDetails.runProfile,
    courseDetails.runCourse,
  );
  const run1 = firstTextValue(courseDetails.run1, courseDetails.run1Profile, courseDetails.run1Course);
  const run2 = firstTextValue(courseDetails.run2, courseDetails.run2Profile, courseDetails.run2Course);
  const terrain = firstTextValue(courseDetails.terrain);
  const surface = firstTextValue(
    courseDetails.surface,
    courseDetails.routeType,
    courseDetails.format,
  );
  const distance = firstTextValue(
    courseDetails.distance,
    courseDetails.distanceKm,
  );
  const elevation = firstTextValue(
    courseDetails.elevationGain,
    courseDetails.elevation,
    courseDetails.climb,
  );
  return [
    profile ? { label: "Profile", value: profile } : undefined,
    swim ? { label: "Swim", value: swim } : undefined,
    run1 ? { label: "Run 1", value: run1 } : undefined,
    bike ? { label: "Bike", value: bike } : undefined,
    run2 ? { label: "Run 2", value: run2 } : undefined,
    run ? { label: "Run", value: run } : undefined,
    terrain ? { label: "Terrain", value: terrain } : undefined,
    surface ? { label: "Surface", value: surface } : undefined,
    distance ? { label: "Distance", value: distance } : undefined,
    elevation ? { label: "Elevation", value: elevation } : undefined,
  ].filter((item): item is { label: string; value: string } => Boolean(item));
}

function asRecordArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is Record<string, unknown> =>
      Boolean(item) && typeof item === "object",
  );
}

function asTextArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => asTextArray(item));
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const text = firstTextValue(
      record.name,
      record.label,
      record.title,
      record.categoryName,
      record.ageCategory,
      record.ageGroup,
    );
    return text ? [text] : [];
  }
  if (typeof value === "string" && value.trim()) return [value.trim()];
  if (typeof value === "number" && Number.isFinite(value))
    return [String(value)];
  return [];
}

function chipTone(index: number): {
  backgroundColor: string;
  borderColor: string;
  color: string;
} {
  const palette = [
    {
      backgroundColor: "rgba(14, 165, 233, 0.14)",
      borderColor: "rgba(14, 165, 233, 0.24)",
      color: "#075985",
    },
    {
      backgroundColor: "rgba(16, 185, 129, 0.14)",
      borderColor: "rgba(16, 185, 129, 0.24)",
      color: "#047857",
    },
    {
      backgroundColor: "rgba(245, 158, 11, 0.14)",
      borderColor: "rgba(245, 158, 11, 0.24)",
      color: "#92400E",
    },
    {
      backgroundColor: "rgba(139, 92, 246, 0.14)",
      borderColor: "rgba(139, 92, 246, 0.24)",
      color: "#6D28D9",
    },
  ];
  return palette[index % palette.length];
}

function ticketFamilyTone(
  title: string,
  index: number,
): {
  backgroundColor: string;
  borderColor: string;
  color: string;
  accent: string;
} {
  const normalized = title.toLowerCase();
  if (normalized.includes("triathlon")) {
    return {
      backgroundColor: "#E0F2FE",
      borderColor: "#38BDF8",
      color: "#075985",
      accent: "#0284C7",
    };
  }
  if (normalized.includes("swimathon") || normalized.includes("swimming")) {
    return {
      backgroundColor: "#DCFCE7",
      borderColor: "#34D399",
      color: "#065F46",
      accent: "#059669",
    };
  }
  const tone = chipTone(index);
  return { ...tone, accent: tone.color };
}

function normalizeAgeGroupLabel(value: string): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (!compact) return compact;
  const enDash = compact.replace(/(\d)\s*[-–]\s*(\d)/g, "$1–$2");
  if (/^above\b/i.test(enDash)) return enDash.replace(/^above\b/i, "Above");
  if (/^kids\b/i.test(enDash)) return enDash.replace(/^kids\b/i, "Kids");
  return enDash;
}

type TicketCategorySummary = {
  title: string;
  date?: string;
  items: TicketCategoryItem[];
};

type TicketCategoryItem = {
  key: string;
  name: string;
  date?: string;
  subcategories: string[];
  ageGroups: string[];
};

type TicketCategoryGroup = {
  id: string;
  label: string;
  tickets: {
    id: string;
    label: string;
    subcategories?: {
      id: string;
      label: string;
    }[];
  }[];
};

function formatDateLabel(value: unknown): string | undefined {
  const text = firstTextValue(value);
  if (!text) return undefined;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return text;
  return parsed.toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function normalizeCategoryName(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ")
    .replace(/[–—]/g, "-");
}

function categoryKey(value: unknown): string {
  return normalizeCategoryName(value)
    .replace(/^BERGMAN\s+/, "")
    .replace(/^SWIMATHON\s+BLR\s*-\s*/, "")
    .replace(/^BERGMAN\s+SWIMATHON\s+BLR\s*-\s*/, "")
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function normalizeTicketFamily(ticket: Record<string, unknown>): string {
  const raw = [
    firstTextValue(ticket.ticketCategory, ticket.category, ticket.ticketType),
    firstTextValue(ticket.ticketName, ticket.name, ticket.title),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (/triathlon|bergman\s*102|olympic/.test(raw)) return "TRIATHLON";
  if (/swim|swimathon|kids\s*500|1\s*km|2\s*km|4\s*km/.test(raw))
    return "SWIMMING";
  return (
    firstTextValue(
      ticket.ticketCategory,
      ticket.category,
      ticket.ticketType,
    )?.toUpperCase() ?? "OTHER"
  );
}

function normalizeTicketCompareName(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .replace(/\s*[-–]\s*/g, " - ")
    .trim()
    .toUpperCase();
}

function normalizeTicketDisplayName(value: string): string {
  const normalized = normalizeTicketCompareName(value);
  if (normalized === "SWIMATHON") return "BERGMAN SWIMATHON";
  return normalized;
}

function isAgeGroupOnlyLabel(value: string): boolean {
  const normalized = normalizeTicketCompareName(value);
  return /^(\d{1,2}\s*[-–]\s*\d{1,2}|ABOVE\s+\d{1,2})$/.test(normalized);
}

function normalizeSwimathonSubcategory(value: string): string {
  const normalized = normalizeCategoryName(value)
    .replace(/^BERGMAN\s+SWIMATHON(?:\s+[A-Z]+)?\s*-\s*/, "")
    .replace(/^BERGMAN\s+SWIMATHON\s*-\s*/, "")
    .replace(/^SWIMATHON(?:\s+[A-Z]+)?\s*-\s*/, "")
    .replace(/^SWIMATHON\s*-\s*/, "")
    .trim();

  if (!normalized || /^BERGMAN\s+SWIMATHON(?:\s+[A-Z]+)?$/.test(normalized))
    return "";
  if (isAgeGroupOnlyLabel(normalized)) return "";
  if (/KIDS\s*500/.test(normalized)) return "KIDS 500 MTRS";
  if (/(^|\s)500\s*MTRS?\b/.test(normalized)) return "KIDS 500 MTRS";
  if (/\b1\s*KM\b/.test(normalized)) return "1 KM";
  if (/\b2\s*KM\b/.test(normalized)) return "2 KM";
  if (/\b4\s*KM\b/.test(normalized)) return "4 KM";
  return "";
}

function normalizeSwimathonParentName(value: string): string {
  const normalized = normalizeCategoryName(value);
  if (!normalized.includes("SWIMATHON")) return "";
  const withoutChild = normalized
    .replace(
      /\s*-\s*(KIDS\s*500\s*MTRS?|500\s*MTRS?|1\s*KM|2\s*KM|4\s*KM).*$/i,
      "",
    )
    .trim();
  if (!withoutChild || /^SWIMATHON$/.test(withoutChild))
    return "BERGMAN SWIMATHON";
  if (/^BERGMAN\s+SWIMATHON/.test(withoutChild)) return withoutChild;
  return withoutChild.replace(/^SWIMATHON/, "BERGMAN SWIMATHON");
}

function addUniqueLabel(target: string[], value: string) {
  const label = normalizeTicketDisplayName(value);
  if (
    !label ||
    target.some(
      (item) =>
        normalizeTicketCompareName(item) === normalizeTicketCompareName(label),
    )
  )
    return;
  target.push(label);
}

function extractTicketDate(
  ticket: Record<string, unknown>,
): string | undefined {
  return formatDateLabel(
    firstTextValue(
      ticket.eventDate,
      ticket.raceDate,
      ticket.date,
      ticket.ticketDate,
      ticket.ticketEventDate,
      ticket.startDate,
    ),
  );
}

function groupTicketCategorySummaries(
  tickets: Record<string, unknown>[],
): TicketCategorySummary[] {
  const groupOrder = ["TRIATHLON", "SWIMMING"];
  const groups = new Map<string, TicketCategorySummary>();
  const itemSeen = new Map<string, Set<string>>();
  for (const ticket of tickets) {
    const title = normalizeTicketFamily(ticket);
    const existing = groups.get(title) ?? { title, items: [] };
    existing.date = existing.date ?? extractTicketDate(ticket);

    const rawName =
      firstTextValue(
        ticket.ticketName,
        ticket.name,
        ticket.title,
        ticket.contestName,
        ticket.categoryName,
      ) ?? title;
    const date = extractTicketDate(ticket);
    const ageGroups = collectTicketAgeLabels(ticket).filter(
      (label) => !normalizeSwimathonSubcategory(label),
    );
    const subcategories = collectTicketSubcategoryLabels(ticket);
    const seen = itemSeen.get(title) ?? new Set<string>();

    if (title === "SWIMMING") {
      const parentName =
        normalizeSwimathonParentName(rawName) || "BERGMAN SWIMATHON";
      const parentKey = "SWIMATHON_PARENT";
      let parent = existing.items.find((item) => item.key === parentKey);
      if (!parent) {
        parent = {
          key: parentKey,
          name: parentName,
          date,
          subcategories: [],
          ageGroups: [],
        };
        existing.items.push(parent);
      } else if (
        parent.name === "BERGMAN SWIMATHON" &&
        parentName !== "BERGMAN SWIMATHON"
      ) {
        parent.name = parentName;
      }
      for (const subcategory of subcategories) {
        addUniqueLabel(
          parent.subcategories,
          normalizeSwimathonSubcategory(subcategory),
        );
      }
      addUniqueLabel(
        parent.subcategories,
        normalizeSwimathonSubcategory(rawName),
      );
      for (const ageGroup of ageGroups) {
        addUniqueLabel(parent.ageGroups, ageGroup);
      }
    } else {
      if (isAgeGroupOnlyLabel(rawName)) {
        groups.set(title, existing);
        itemSeen.set(title, seen);
        continue;
      }

      const displayName = normalizeTicketDisplayName(rawName);
      const idKey = firstTextValue(
        ticket.ticketId,
        ticket.id,
        ticket.contestId,
        ticket.contestUuid,
        ticket.providerContestUuid,
      );
      const compareKey = categoryKey(displayName);
      const key = idKey ? `${idKey}:${compareKey}` : compareKey;
      if (displayName && !seen.has(compareKey) && !seen.has(key)) {
        seen.add(key);
        seen.add(compareKey);
        existing.items.push({
          key,
          name: displayName,
          date,
          subcategories: subcategories.filter(
            (label) =>
              !isAgeGroupOnlyLabel(label) &&
              !normalizeSwimathonSubcategory(label),
          ),
          ageGroups,
        });
      }
    }

    groups.set(title, existing);
    itemSeen.set(title, seen);
  }
  return [...groups.values()].sort((a, b) => {
    const ai = groupOrder.indexOf(a.title);
    const bi = groupOrder.indexOf(b.title);
    if (ai !== -1 || bi !== -1)
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    return a.title.localeCompare(b.title);
  });
}

function toTicketCategoryGroups(
  summaries: TicketCategorySummary[],
): TicketCategoryGroup[] {
  return summaries
    .filter(
      (group) => group.title === "TRIATHLON" || group.title === "SWIMMING",
    )
    .map((group) => ({
      id: categoryKey(group.title).toLowerCase(),
      label: group.title,
      tickets: group.items.map((item) => ({
        id: categoryKey(item.name || item.key).toLowerCase(),
        label: item.name,
        subcategories: item.subcategories.map((label) => ({
          id: categoryKey(label).toLowerCase(),
          label,
        })),
      })),
    }))
    .filter((group) => group.tickets.length > 0);
}

function firstRecordArray(...values: unknown[]): Record<string, unknown>[] {
  for (const value of values) {
    const rows = asRecordArray(value);
    if (rows.length > 0) return rows;
  }
  return [];
}

function collectDisciplineScheduleRows(schedule: unknown): string[] {
  const rows = new Set<string>();
  if (Array.isArray(schedule)) {
    for (const item of schedule) {
      if (!item) continue;
      if (typeof item === "string") {
        if (item.trim()) rows.add(item.trim());
        continue;
      }
      if (typeof item === "object") {
        const record = item as Record<string, unknown>;
        const label =
          firstTextValue(
            record.label,
            record.name,
            record.title,
            record.day,
            record.discipline,
            record.category,
            record.event,
          ) ?? "Schedule";
        const time = firstTextValue(
          record.time,
          record.startTime,
          record.start,
          record.endTime,
          record.end,
          record.date,
        );
        rows.add(time ? `${label}: ${time}` : label);
      }
    }
  } else if (schedule && typeof schedule === "object") {
    for (const [key, value] of Object.entries(
      schedule as Record<string, unknown>,
    )) {
      if (value == null) continue;
      if (typeof value === "string" || typeof value === "number") {
        rows.add(`${key}: ${value}`);
        continue;
      }
      if (typeof value === "object") {
        const record = value as Record<string, unknown>;
        const label =
          firstTextValue(record.label, record.name, record.title) ?? key;
        const time = firstTextValue(
          record.time,
          record.startTime,
          record.start,
          record.endTime,
          record.end,
          record.date,
        );
        rows.add(time ? `${label}: ${time}` : label);
      }
    }
  }
  return [...rows];
}

function TicketChips({ values }: { values: string[] }) {
  const theme = useTheme();
  const uniqueValues = Array.from(
    new Set(values.map(normalizeAgeGroupLabel).filter(Boolean)),
  );
  if (uniqueValues.length === 0) return null;
  return (
    <View
      style={{ flexDirection: "row", flexWrap: "wrap", gap: theme.spacing.xs }}
    >
      {uniqueValues.map((value, index) => {
        const tone = chipTone(index);
        return (
          <View
            key={value}
            style={{
              paddingHorizontal: 10,
              paddingVertical: 6,
              borderRadius: 999,
              backgroundColor: tone.backgroundColor,
              borderWidth: 1,
              borderColor: tone.borderColor,
            }}
          >
            <Text
              variant="bodySmall"
              style={{ color: tone.color, fontWeight: "600" }}
            >
              {value}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

function collectTicketSubcategoryLabels(
  ticket: Record<string, unknown>,
): string[] {
  const subCategories = asRecordArray(ticket.subCategories);
  if (subCategories.length > 0) {
    return subCategories
      .map((subCategory) =>
        firstTextValue(
          subCategory.name,
          subCategory.ticketName,
          subCategory.title,
          subCategory.label,
        ),
      )
      .filter((value): value is string => Boolean(value));
  }
  return asTextArray(
    ticket.subCategory ??
      ticket.subCategories ??
      ticket.distances ??
      ticket.distance,
  );
}

function collectTicketAgeLabels(ticket: Record<string, unknown>): string[] {
  const fromTicket = asTextArray(
    ticket.applicableAgeGroups ?? ticket.ageGroups ?? ticket.categories,
  );
  const fromSubCategories = asRecordArray(ticket.subCategories).flatMap(
    (subCategory) =>
      asTextArray(
        subCategory.applicableAgeGroups ??
          subCategory.ageGroups ??
          subCategory.categories,
      ),
  );
  return [...fromTicket, ...fromSubCategories];
}

function TicketCategorySummarySection({
  group,
  index,
}: {
  group: TicketCategoryGroup;
  index: number;
}) {
  const theme = useTheme();
  const tone = ticketFamilyTone(group.label, index);

  return (
    <View
      style={{
        gap: theme.spacing.sm,
        borderWidth: 1,
        borderColor: tone.borderColor,
        borderRadius: theme.radius.large,
        overflow: "hidden",
        backgroundColor: theme.colors.surface,
      }}
    >
      <View
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: theme.spacing.sm,
          paddingHorizontal: theme.spacing.md,
          paddingVertical: theme.spacing.sm,
          backgroundColor: tone.backgroundColor,
          borderBottomWidth: 1,
          borderBottomColor: tone.borderColor,
        }}
      >
        <View style={{ gap: 2 }}>
          <Text
            variant="caption"
            style={{
              color: tone.accent,
              fontWeight: "800",
              textTransform: "uppercase",
            }}
          >
            Ticket Category
          </Text>
          <Text variant="headline" style={{ color: tone.color }}>
            {group.label}
          </Text>
        </View>
      </View>

      <View style={{ gap: theme.spacing.sm, padding: theme.spacing.sm }}>
        {group.tickets.map((item, ticketIndex) => {
          return (
            <View
              key={`${group.id}-${item.id}`}
              style={{
                gap: theme.spacing.xs,
                padding: theme.spacing.sm,
                borderRadius: theme.radius.large,
                backgroundColor:
                  ticketIndex % 2 === 0
                    ? theme.colors.surfaceElevated
                    : theme.colors.surface,
                borderWidth: 1,
                borderColor: theme.colors.border,
              }}
            >
              <View
                style={{
                  flexDirection: "row",
                  flexWrap: "wrap",
                  alignItems: "center",
                  gap: theme.spacing.xs,
                }}
              >
                <Text variant="body" style={{ fontWeight: "700" }}>
                  {item.label}
                </Text>
              </View>

              {item.subcategories && item.subcategories.length > 0 ? (
                <View style={{ gap: 6 }}>
                  <Text variant="caption" color="textMuted">
                    Sub categories
                  </Text>
                  <TicketChips
                    values={item.subcategories.map(
                      (subcategory) => subcategory.label,
                    )}
                  />
                </View>
              ) : null}
            </View>
          );
        })}
      </View>
    </View>
  );
}

function courseProfileIcon(label: string): string {
  const normalized = label.toLowerCase();
  if (normalized.includes("swim")) return "🏊";
  if (normalized.includes("bike") || normalized.includes("cycle")) return "🚴";
  if (normalized.includes("run")) return "🏃";
  return "•";
}

function CourseProfileContent({
  rows,
  compact = false,
}: {
  rows: { label: string; value: string }[];
  compact?: boolean;
}) {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const isNarrow = width < 430;
  const preferred = ["Swim", "Run 1", "Bike", "Run 2", "Run"];
  const displayRows = preferred
    .map((label) =>
      rows.find((row) => row.label.toLowerCase() === label.toLowerCase()),
    )
    .filter((row): row is { label: string; value: string } => Boolean(row));
  const fallbackRows = displayRows.length > 0 ? displayRows : rows;

  return (
    <View style={{ gap: compact ? theme.spacing.sm : theme.spacing.md }}>
      {compact ? null : <Text variant="headline">Course Profile</Text>}
      {fallbackRows.length > 0 ? (
        <View
          style={{
            flexDirection: "row",
            flexWrap: "wrap",
            gap: compact ? 6 : theme.spacing.sm,
          }}
        >
          {fallbackRows.map((row) => (
            <View
              key={row.label}
              style={{
                flexGrow: isNarrow ? 0 : 1,
                flexShrink: 1,
                flexBasis: isNarrow ? "100%" : compact ? "30%" : "30%",
                width: isNarrow ? "100%" : undefined,
                minWidth: isNarrow ? 0 : compact ? 84 : 120,
                gap: compact ? 2 : 6,
                paddingVertical: compact ? 6 : theme.spacing.sm,
                paddingHorizontal: compact ? 8 : theme.spacing.sm,
                borderRadius: theme.radius.large,
                backgroundColor: compact
                  ? theme.colors.surface
                  : theme.colors.surfaceElevated,
                borderWidth: 1,
                borderColor: theme.colors.border,
              }}
            >
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 8,
                  minWidth: 0,
                }}
              >
                <Text variant={compact ? "bodySmall" : "headline"}>
                  {courseProfileIcon(row.label)}
                </Text>
                <Text
                  variant="caption"
                  color="textMuted"
                  style={{ fontWeight: "700", flexShrink: 1 }}
                >
                  {row.label}
                </Text>
              </View>
              <Text
                variant={compact ? "bodySmall" : "body"}
                style={{ fontWeight: "700", flexShrink: 1 }}
              >
                {row.value}
              </Text>
            </View>
          ))}
        </View>
      ) : (
        <Text variant="bodySmall" color="textMuted">
          From event data
        </Text>
      )}
    </View>
  );
}

function CountdownCourseCard({
  countdownParts,
}: {
  countdownParts?: {
    days: string;
    hours: string;
    minutes: string;
    seconds: string;
  };
}) {
  const theme = useTheme();
  return (
    <Card style={{ gap: theme.spacing.sm }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: theme.spacing.sm,
        }}
      >
        <View style={{ flex: 1, gap: 4 }}>
          <Text
            variant="caption"
            color="textMuted"
            style={{ letterSpacing: 0.6, textTransform: "uppercase" }}
          >
            Countdown
          </Text>
        </View>
      </View>
      {countdownParts ? (
        <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
          {[
            { value: countdownParts.days, label: "DAYS" },
            { value: countdownParts.hours, label: "HRS" },
            { value: countdownParts.minutes, label: "MIN" },
            { value: countdownParts.seconds, label: "SEC" },
          ].map((item) => (
            <View
              key={item.label}
              style={{
                flexGrow: 1,
                flexBasis: 72,
                minWidth: 72,
                height: 78,
                borderRadius: theme.radius.large,
                backgroundColor: theme.colors.surface,
                borderWidth: 1,
                borderColor: theme.colors.border,
                alignItems: "center",
                justifyContent: "center",
                gap: 4,
              }}
            >
              <Text
                variant="display"
                style={{
                  color: theme.colors.accent,
                  fontWeight: "900",
                  lineHeight: 34,
                }}
              >
                {item.value}
              </Text>
              <Text
                variant="caption"
                color="textMuted"
                style={{ fontWeight: "800", letterSpacing: 1 }}
              >
                {item.label}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </Card>
  );
}

export function EventInfoScreen() {
  const [countdownNow, setCountdownNow] = useState(() => Date.now());
  const theme = useTheme();
  const { height } = useWindowDimensions();
  const router = useRouter();
  const { eventId } = useLocalSearchParams<{ eventId: string | string[] }>();
  const id = safeRouteEventId(eventId) ?? "";
  const rawEventId = id;
  const {
    event,
    isLoading: isEventLoading,
    isError: isEventError,
    refetch: refetchEvent,
  } = useEvent(id);
  const ticketsQuery = useQuery({
    queryKey: queryKeys.events.tickets(id),
    queryFn: () => repositories.events.getEventTickets(id),
    enabled: Boolean(id),
    retry: false,
    staleTime: 5 * 60_000,
  });
  const cutoffQuery = useEventCourseCutoffs(id, Boolean(id));
  const [showRules, setShowRules] = useState(false);
  const eventRecord =
    event?.raw && typeof event.raw === "object"
      ? (event.raw as Record<string, unknown>)
      : undefined;
  const ticketDefinitions = useMemo(
    () =>
      firstRecordArray(
        event?.ticketDefinitions,
        eventRecord?.ticketDefinitions,
      ),
    [event, eventRecord],
  );
  const customContentHtml = firstHtmlValue(
    event?.customContent,
    eventRecord?.customContent,
    eventRecord?.customContentHtml,
  );
  const disciplineSchedule =
    event?.disciplineSchedule ?? eventRecord?.disciplineSchedule;

  useEffect(() => {
    if (process.env.NODE_ENV !== "production" && event) {
      console.log("Screen ticketDefinitions", event.ticketDefinitions);
    }
  }, [event]);
  useEffect(() => {
    if (!id) {
      console.error("[event-info-route] Missing/invalid event id from route", {
        rawEventId,
      });
    }
  }, [id, rawEventId]);
  useEffect(() => {
    const interval = setInterval(() => setCountdownNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);
  const disciplineScheduleRows = useMemo(
    () => collectDisciplineScheduleRows(disciplineSchedule),
    [disciplineSchedule],
  );
  const eventRulesHtml = firstHtmlValue(
    event?.customRulesHtml,
    event?.rulesAndRegulationsHtml,
    event?.rulesHtml,
    event?.regulationsHtml,
    event?.rulesContentHtml,
    event?.regulationsContentHtml,
    event?.raw && typeof event.raw === "object"
      ? firstHtmlValue(
          (event.raw as Record<string, unknown>).customRulesHtml,
          (event.raw as Record<string, unknown>).rulesAndRegulationsHtml,
          (event.raw as Record<string, unknown>).rulesHtml,
          (event.raw as Record<string, unknown>).regulationsHtml,
          (event.raw as Record<string, unknown>).rulesContentHtml,
          (event.raw as Record<string, unknown>).regulationsContentHtml,
        )
      : undefined,
  );
  const visibleTickets = useMemo(
    () =>
      (ticketsQuery.data?.tickets ?? []).filter(
        (ticket) =>
          ticket &&
          typeof ticket === "object" &&
          (ticket as Record<string, unknown>).isHidden !== true,
      ) as Record<string, unknown>[],
    [ticketsQuery.data],
  );
  const courseMapTicketDefinitions = useMemo(
    () =>
      firstRecordArray(
        eventRecord?.courseMapTicketDefinitions,
        eventRecord?.courseMap && typeof eventRecord.courseMap === "object"
          ? (eventRecord.courseMap as Record<string, unknown>).ticketDefinitions
          : undefined,
      ),
    [eventRecord],
  );
  const timingFallbackTickets = useMemo(
    () =>
      firstRecordArray(
        eventRecord?.timingConfiguration &&
          typeof eventRecord.timingConfiguration === "object"
          ? (eventRecord.timingConfiguration as Record<string, unknown>)
              .contests
          : undefined,
        eventRecord?.contests,
      ),
    [eventRecord],
  );
  const ticketCards =
    ticketDefinitions.length > 0
      ? ticketDefinitions
      : courseMapTicketDefinitions.length > 0
        ? courseMapTicketDefinitions
        : timingFallbackTickets;
  const ticketCategorySummaries = useMemo(
    () => groupTicketCategorySummaries(ticketCards),
    [ticketCards],
  );
  const normalizedTicketGroups = useMemo(
    () => toTicketCategoryGroups(ticketCategorySummaries),
    [ticketCategorySummaries],
  );
  const hasRegisterableTicket = visibleTickets.some(
    (ticket) => ticket.isSoldOut !== true,
  );
  const allTicketsSoldOut = visibleTickets.length > 0 && !hasRegisterableTicket;
  const rulesQuery = useQuery({
    queryKey: queryKeys.events.rules(id),
    queryFn: () => repositories.events.getEventRules(id),
    enabled: showRules && Boolean(id) && !eventRulesHtml,
    retry: false,
    staleTime: 5 * 60_000,
  });

  const countdownParts =
    event?.status === "upcoming"
      ? formatCountdownParts(event.countdownTargetAt ?? event.startAt ?? "", countdownNow)
      : undefined;
  const temperatureLabel = formatTemperature(event?.temperatureMetrics);
  const temperatureRows = formatTemperatureRows(event?.temperatureMetrics);
  const ticketCourseProfiles = useMemo(
    () =>
      ticketCards
        .map((ticket) => {
          const details = ticket.courseDetails;
          const rows = details && typeof details === "object"
            ? formatCourseProfile(details as Record<string, unknown>)
            : [];
          return {
            id: firstTextValue(ticket.id, ticket.ticketId, ticket.ticketName) || "ticket",
            name: firstTextValue(ticket.ticketName, ticket.name) || "Race",
            rows,
          };
        })
        .filter((profile) => profile.rows.length > 0),
    [ticketCards],
  );
  const legacyCourseProfileRows = formatCourseProfile(event?.courseDetails);
  const publicCutoffGroups = useMemo(
    () => formatContestCutoffGroups(cutoffQuery.data?.contests),
    [cutoffQuery.data?.contests],
  );
  const ticketCutoffGroups = useMemo(
    () =>
      formatContestCutoffGroups(ticketCards).filter(
        (contest) =>
          contest.cutoffs.length > 0 ||
          contest.subCategories.some((item) => item.cutoff),
      ),
    [ticketCards],
  );
  const cutoffGroups =
    ticketCutoffGroups.length > 0 ? ticketCutoffGroups : publicCutoffGroups;
  const cutoffSummary = useMemo(
    () =>
      cutoffGroups.length > 0
        ? cutoffGroups.flatMap((contest) => [
            `${contest.label}${contest.cutoffs.length > 0 ? ` · ${contest.cutoffs.map((cutoff) => `${cutoff.label}: ${cutoff.value}`).join(" · ")}` : ""}`,
          ])
        : formatCutoffSummary(event?.cutoffMinutes, event?.cutoffs),
    [event?.cutoffMinutes, event?.cutoffs, cutoffGroups],
  );
  const nearestAirportLabel = formatAirport(eventRecord?.nearestAirport);
  const currentRulesHtml = eventRulesHtml ?? rulesQuery.data ?? null;
  const rulesTarget =
    event?.rulesUrl ?? event?.regulationsUrl ?? event?.rulesAndRegulationsUrl;
  const guidebookTarget = resolveValidGuidebook(event);
  const [showCutoffs, setShowCutoffs] = useState(false);
  const openGuidebook = () => {
    if (!guidebookTarget) return;
    if (!id) return;
    router.push({
      pathname: "/event/[eventId]/guidebook",
      params: {
        eventId: id,
        url: guidebookTarget.originalUrl,
        title: `${event?.name ?? "Event"} Athlete Guidebook`,
      },
    });
  };
  const googleMapsTarget = firstTextValue(
    eventRecord?.googleMapsUrl,
    eventRecord?.mapsUrl,
    eventRecord?.googleMapsLink,
    eventRecord?.mapUrl,
  );
  const organizerLabel = firstTextValue(
    eventRecord?.organizer,
    eventRecord?.organizerName,
    eventRecord?.organizerTitle,
    eventRecord?.organizerLabel,
  );
  const liveTrackingSummary = [
    firstTextValue(
      event?.liveTrackingProviderState &&
        typeof event.liveTrackingProviderState === "object"
        ? (event.liveTrackingProviderState as Record<string, unknown>).provider
        : undefined,
    ),
    firstTextValue(
      event?.liveTrackingProviderState &&
        typeof event.liveTrackingProviderState === "object"
        ? (event.liveTrackingProviderState as Record<string, unknown>).status
        : undefined,
    ),
    firstTextValue(
      event?.liveTracking && typeof event.liveTracking === "object"
        ? (event.liveTracking as Record<string, unknown>).status
        : undefined,
    ),
  ]
    .filter(Boolean)
    .join(" · ");

  const openRules = () => {
    if (rulesTarget) {
      if (/^https?:\/\//i.test(rulesTarget)) {
        void Linking.openURL(rulesTarget);
        return;
      }
      router.push(rulesTarget as Href);
      return;
    }
    router.push("/terms");
  };

  useEffect(() => {
    if (process.env.NODE_ENV === "production" || !event) return;
    console.log("[ticket-categories]", {
      rawTicketDefinitions: event.ticketDefinitions?.length ?? 0,
      rawCourseMapTickets: courseMapTicketDefinitions.length,
      rawContests: asRecordArray(eventRecord?.contests).length,
      normalizedGroups: normalizedTicketGroups,
    });
  }, [
    courseMapTicketDefinitions.length,
    event,
    eventRecord?.contests,
    normalizedTicketGroups,
  ]);

  if (isEventLoading && !event) {
    return (
      <SafeAreaView
        style={{ flex: 1, backgroundColor: theme.colors.background }}
      >
        <View style={{ padding: theme.spacing.base, gap: theme.spacing.md }}>
          <Skeleton height={220} radius={theme.radius.xl} />
          <Skeleton height={80} radius={theme.radius.large} />
        </View>
      </SafeAreaView>
    );
  }

  if (!id || isEventError || !event) {
    return (
      <SafeAreaView
        style={{ flex: 1, backgroundColor: theme.colors.background }}
      >
        <View style={{ padding: theme.spacing.base }}>
          <ErrorState
            title="Event unavailable"
            description={
              id
                ? "We couldn't load this event."
                : `Missing eventId in route. raw=${String(rawEventId ?? "") || "empty"}.`
            }
            onRetry={refetchEvent}
          />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: theme.colors.background }}
      edges={["top", "left", "right"]}
    >
      <ScrollView
        contentContainerStyle={{
          padding: theme.spacing.base,
          gap: theme.spacing.lg,
          paddingBottom: 40,
        }}
        showsVerticalScrollIndicator={false}
      >
        <Card padded={false} style={{ overflow: "hidden" }}>
          <Image
            source={event.imageUri ? { uri: event.imageUri } : eventPlaceholder}
            style={{ width: "100%", height: 220 }}
            contentFit="cover"
          />
          <View
            style={{
              position: "absolute",
              top: theme.spacing.base,
              left: theme.spacing.base,
              right: theme.spacing.base,
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Back to home"
              hitSlop={12}
              onPress={() =>
                router.canGoBack() ? router.back() : router.replace("/")
              }
              style={{
                width: 40,
                height: 40,
                borderRadius: 20,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: "rgba(0,0,0,0.45)",
                zIndex: 10,
                elevation: 10,
              }}
            >
              <Icon name="chevronLeft" colorValue="#fff" />
            </Pressable>
            <Badge
              label={
                event.status === "live"
                  ? "LIVE"
                  : event.status === "finished"
                    ? "RESULTS"
                    : "UPCOMING"
              }
              variant={event.status === "live" ? "live" : "neutral"}
            />
          </View>

          <View style={{ padding: theme.spacing.base, gap: theme.spacing.sm }}>
            <Text variant="display">{event.name}</Text>
            {event.status !== "finished" ? (
              <>
                <Button
                  label="Live Tracking"
                  variant="primary"
                  size="sm"
                  onPress={() =>
                    id &&
                    router.push({
                      pathname: "/event/[eventId]/track",
                      params: { eventId: id },
                    })
                  }
                />
                <Button
                  label="Live Broadcast"
                  variant="secondary"
                  size="sm"
                  onPress={() =>
                    id &&
                    router.push({
                      pathname: "/event/[eventId]/broadcast",
                      params: { eventId: id },
                    })
                  }
                />
              </>
            ) : null}
            <Text variant="bodySmall" color="textMuted">
              {[event.dateLabel, event.location, event.discipline]
                .filter(Boolean)
                .join(" · ") || "Event details from backend"}
            </Text>
            {event.distances ? (
              <Text variant="body" color="textSecondary">
                {event.distances}
              </Text>
            ) : null}
            {event.status === "finished" ? (
              <Button
                label="Official Results"
                variant="primary"
                size="sm"
                onPress={() =>
                  id &&
                  router.push({
                    pathname: "/event/[eventId]/results",
                    params: { eventId: id },
                  })
                }
              />
            ) : null}
            <Button
              label={allTicketsSoldOut ? "Sold Out" : "Register"}
              variant="secondary"
              size="sm"
              disabled={allTicketsSoldOut || !hasRegisterableTicket}
              onPress={() => undefined}
            />
          </View>
        </Card>

        <CountdownCourseCard countdownParts={countdownParts} />

        <Card style={{ gap: theme.spacing.sm }}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              gap: theme.spacing.sm,
            }}
          >
            <Text variant="headline">Course Profile</Text>
            {cutoffSummary.length > 0 ? (
              <Button
                label="Cutoffs"
                variant="secondary"
                size="sm"
                onPress={() => setShowCutoffs(true)}
              />
            ) : null}
          </View>
          {ticketCourseProfiles.length > 0 ? (
            <View style={{ gap: theme.spacing.md }}>
              {ticketCourseProfiles.map((profile) => (
                <View key={profile.id} style={{ gap: theme.spacing.xs }}>
                  <Text variant="bodySmall" style={{ fontWeight: "800" }}>{profile.name}</Text>
                  <CourseProfileContent rows={profile.rows} compact />
                </View>
              ))}
            </View>
          ) : (
            <CourseProfileContent rows={legacyCourseProfileRows} compact />
          )}
        </Card>

        <Card style={{ gap: theme.spacing.md }}>
          <View style={{ gap: theme.spacing.xs }}>
            <Text variant="headline">Event Information</Text>
            <Text variant="bodySmall" color="textMuted">
              Organizer, guidebook, maps, live-tracking settings, and
              temperature overview.
            </Text>
          </View>

          <View
            style={{
              flexDirection: "row",
              flexWrap: "wrap",
              gap: theme.spacing.sm,
            }}
          >
            {temperatureRows.length > 0 ? (
              temperatureRows.map((row) => (
                <Card
                  key={row.label}
                  style={{
                    flexGrow: 1,
                    flexBasis: "31%",
                    minWidth: 160,
                    gap: 4,
                    backgroundColor: theme.colors.surface,
                  }}
                >
                  <Text variant="caption" color="textMuted">
                    {row.label}
                  </Text>
                  <Text variant="body">{row.value}</Text>
                </Card>
              ))
            ) : (
              <Card
                style={{
                  flexGrow: 1,
                  gap: 4,
                  backgroundColor: theme.colors.surface,
                }}
              >
                <Text variant="caption" color="textMuted">
                  Temperature
                </Text>
                <Text variant="body">
                  {temperatureLabel ?? "From event data"}
                </Text>
              </Card>
            )}
          </View>

          <View style={{ gap: theme.spacing.sm }}>
            <Text variant="bodySmall" color="textMuted">
              Organizer
            </Text>
            <Text variant="body">{organizerLabel ?? "From event data"}</Text>
            <Text variant="bodySmall" color="textMuted">
              Nearest airport
            </Text>
            <Text variant="body">
              {nearestAirportLabel ?? "From event data"}
            </Text>
            <Text variant="bodySmall" color="textMuted">
              Live tracking
            </Text>
            <Text variant="body">
              {liveTrackingSummary || "From live tracking configuration"}
            </Text>
          </View>

          <View
            style={{
              flexDirection: "row",
              flexWrap: "wrap",
              gap: theme.spacing.sm,
            }}
          >
            {googleMapsTarget ? (
              <Button
                label="Open in Google Maps"
                variant="ghost"
                size="sm"
                fullWidth
                onPress={() => void Linking.openURL(googleMapsTarget)}
              />
            ) : null}
            {guidebookTarget ? (
              <Button
                label="Athlete Guidebook"
                variant="secondary"
                size="sm"
                fullWidth
                onPress={openGuidebook}
              />
            ) : (
              <Button
                label="Guidebook coming soon"
                variant="ghost"
                size="sm"
                fullWidth
                disabled
                onPress={() => undefined}
              />
            )}
            {rulesTarget ? (
              <Button
                label="Rules & Regulations"
                variant="ghost"
                size="sm"
                fullWidth
                onPress={() => setShowRules(true)}
              />
            ) : null}
          </View>
        </Card>

        {showCutoffs ? (
          <RNModal
            visible
            transparent
            animationType="fade"
            onRequestClose={() => setShowCutoffs(false)}
          >
            <Pressable
              onPress={() => setShowCutoffs(false)}
              style={[
                StyleSheet.absoluteFill,
                { backgroundColor: "rgba(0,0,0,0.45)" },
              ]}
            />
            <View style={{ flex: 1, justifyContent: "flex-end" }}>
              <View
                style={{
                  backgroundColor: "#FFFFFF",
                  borderTopLeftRadius: 24,
                  borderTopRightRadius: 24,
                  paddingTop: 12,
                  paddingHorizontal: 16,
                  paddingBottom: 0,
                  maxHeight: "88%",
                }}
              >
                <View style={{ alignItems: "center", paddingBottom: 12 }}>
                  <View
                    style={{
                      width: 52,
                      height: 5,
                      borderRadius: 999,
                      backgroundColor: "#E5E7EB",
                    }}
                  />
                </View>
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                    paddingHorizontal: 4,
                  }}
                >
                  <Text
                    variant="headline"
                    style={{
                      fontSize: 28,
                      lineHeight: 30,
                      fontWeight: "900",
                      fontStyle: "italic",
                      letterSpacing: -0.8,
                    }}
                  >
                    BERGMAN RACE CUT-OFF TIMING
                  </Text>
                  <Pressable
                    onPress={() => setShowCutoffs(false)}
                    hitSlop={10}
                    style={{ padding: 4 }}
                  >
                    <Text
                      variant="headline"
                      style={{ color: "#111827", lineHeight: 22 }}
                    >
                      ×
                    </Text>
                  </Pressable>
                </View>
                <Text
                  variant="bodySmall"
                  color="textMuted"
                  style={{
                    textAlign: "center",
                    marginTop: 10,
                    marginBottom: 18,
                  }}
                >
                  Note: Cut-off times are based on your individual start time.
                </Text>

                <ScrollView
                  showsVerticalScrollIndicator={false}
                  contentContainerStyle={{ gap: 14, paddingBottom: 18 }}
                >
                  {cutoffGroups.length > 0 ? (
                    cutoffGroups.map((contest) => (
                      <View
                        key={contest.id}
                        style={{
                          borderWidth: 1.5,
                          borderColor: "#1F2937",
                          borderRadius: 18,
                          padding: 12,
                          gap: 10,
                          backgroundColor: "#FFFFFF",
                        }}
                      >
                        <Text
                          variant="caption"
                          style={{
                            color: "#2457F5",
                            fontWeight: "900",
                            letterSpacing: 0.2,
                            textTransform: "uppercase",
                          }}
                        >
                          {contest.label}
                        </Text>
                        <View style={{ gap: 8 }}>
                          {contest.cutoffs.map((cutoff) => {
                            const isOverall =
                              cutoff.label.toLowerCase() === "overall";
                            return (
                              <View
                                key={`${contest.id}-${cutoff.label}`}
                                style={{
                                  flexDirection: "row",
                                  alignItems: "center",
                                  gap: 10,
                                }}
                              >
                                <Text
                                  variant="bodySmall"
                                  style={{
                                    flex: 1,
                                    color: "#6B7280",
                                    fontWeight: "600",
                                  }}
                                >
                                  {cutoff.label === "Overall"
                                    ? "Overall Finish"
                                    : `${cutoff.label} Finish`}
                                </Text>
                                <View
                                  style={{
                                    paddingHorizontal: 14,
                                    paddingVertical: 7,
                                    borderRadius: 999,
                                    borderWidth: isOverall ? 0 : 1.2,
                                    borderColor: isOverall
                                      ? "transparent"
                                      : "#111827",
                                    backgroundColor: isOverall
                                      ? "#4F81F7"
                                      : "#FFFFFF",
                                    minWidth: 112,
                                    alignItems: "center",
                                  }}
                                >
                                  <Text
                                    variant="bodySmall"
                                    style={{
                                      color: isOverall ? "#FFFFFF" : "#111827",
                                      fontWeight: "900",
                                      letterSpacing: 1,
                                    }}
                                  >
                                    {cutoff.value}
                                  </Text>
                                </View>
                              </View>
                            );
                          })}
                          {contest.subCategories.length > 0 ? (
                            <View style={{ gap: 8 }}>
                              {contest.subCategories.map((subCategory) => (
                                <View
                                  key={subCategory.id}
                                  style={{
                                    flexDirection: "row",
                                    alignItems: "center",
                                    gap: 10,
                                  }}
                                >
                                  <Text
                                    variant="bodySmall"
                                    style={{
                                      flex: 1,
                                      color: "#111827",
                                      fontWeight: "700",
                                    }}
                                  >
                                    {subCategory.name}
                                  </Text>
                                  {typeof subCategory.cutoff === "string" ? (
                                    <View
                                      style={{
                                        paddingHorizontal: 14,
                                        paddingVertical: 7,
                                        borderRadius: 999,
                                        borderWidth: 1.2,
                                        borderColor: "#111827",
                                        backgroundColor: "#FFFFFF",
                                        minWidth: 112,
                                        alignItems: "center",
                                      }}
                                    >
                                      <Text
                                        variant="bodySmall"
                                        style={{
                                          color: "#111827",
                                          fontWeight: "900",
                                          letterSpacing: 1,
                                        }}
                                      >
                                        {subCategory.cutoff}
                                      </Text>
                                    </View>
                                  ) : null}
                                </View>
                              ))}
                            </View>
                          ) : null}
                        </View>
                      </View>
                    ))
                  ) : (
                    <Text variant="body" color="textMuted">
                      Cutoff details from event data
                    </Text>
                  )}
                </ScrollView>

                <View style={{ paddingVertical: 12 }}>
                  <Pressable
                    onPress={() => setShowCutoffs(false)}
                    style={{
                      borderRadius: 14,
                      backgroundColor: "#2F67F5",
                      paddingVertical: 14,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Text
                      variant="body"
                      style={{
                        color: "#FFFFFF",
                        fontWeight: "900",
                        letterSpacing: 1.2,
                      }}
                    >
                      CLOSE
                    </Text>
                  </Pressable>
                </View>
              </View>
            </View>
          </RNModal>
        ) : null}

        {customContentHtml ? (
          <Card style={{ gap: theme.spacing.md }}>
            <View style={{ gap: theme.spacing.xs }}>
              <Text variant="headline">Event Content</Text>
              <Text variant="bodySmall" color="textMuted">
                Custom HTML content from the event payload.
              </Text>
            </View>
            <EventHtmlContent html={customContentHtml} />
          </Card>
        ) : null}

        {disciplineScheduleRows.length > 0 ? (
          <Card style={{ gap: theme.spacing.md }}>
            <View style={{ gap: theme.spacing.xs }}>
              <Text variant="headline">Discipline Schedule</Text>
              <Text variant="bodySmall" color="textMuted">
                Schedule rows resolved from event data.
              </Text>
            </View>
            <View style={{ gap: theme.spacing.xs }}>
              {disciplineScheduleRows.map((line) => (
                <Text key={line} variant="bodySmall" color="textSecondary">
                  {line}
                </Text>
              ))}
            </View>
          </Card>
        ) : null}

        <Card style={{ gap: theme.spacing.md }}>
          <View style={{ gap: theme.spacing.xs }}>
            <Text variant="headline">Ticket Categories</Text>
            <Text variant="bodySmall" color="textMuted">
              Category-wise ticket options and sub-categories from the event
              payload.
            </Text>
          </View>
          {normalizedTicketGroups.length > 0 ? (
            <View style={{ gap: theme.spacing.lg }}>
              {normalizedTicketGroups.map((group, groupIndex) => (
                <TicketCategorySummarySection
                  key={group.id}
                  group={group}
                  index={groupIndex}
                />
              ))}
            </View>
          ) : (
            <EmptyState
              title="No ticket definitions"
              description="The event payload did not return any ticket definitions for this event."
            />
          )}
        </Card>

        <Card style={{ gap: theme.spacing.md }}>
          <View style={{ gap: theme.spacing.xs }}>
            <Text variant="headline">Race details</Text>
          </View>
          <Button
            label="Rules & regulations"
            variant="ghost"
            size="sm"
            fullWidth
            onPress={() => setShowRules(true)}
          />
          {guidebookTarget ? (
            <View style={{ gap: theme.spacing.sm }}>
              <Button
                label="Athlete Guidebook"
                variant="secondary"
                size="sm"
                fullWidth
                onPress={openGuidebook}
              />
            </View>
          ) : null}
        </Card>
      </ScrollView>

      <Modal
        visible={showRules}
        onClose={() => setShowRules(false)}
        title="Rules & Regulations"
      >
        <View
          style={{
            width: "100%",
            height: Math.min(height * 0.9, 760),
            gap: theme.spacing.md,
          }}
        >
          <Card
            style={{
              flex: 1,
              gap: theme.spacing.md,
              backgroundColor: "#FFFFFF",
              borderRadius: theme.radius.large,
            }}
          >
            <View
              style={{
                flexDirection: "row",
                gap: theme.spacing.sm,
                flexWrap: "wrap",
              }}
            >
              <Button
                label="Close"
                variant="ghost"
                size="sm"
                onPress={() => setShowRules(false)}
              />
              <Button
                label="Share"
                variant="secondary"
                size="sm"
                onPress={() =>
                  void Share.share({
                    message:
                      rulesTarget ?? `Rules & Regulations · ${event.name}`,
                  })
                }
              />
              <Button
                label="Open externally"
                variant="primary"
                size="sm"
                disabled={!rulesTarget}
                onPress={openRules}
              />
            </View>
            {rulesQuery.isLoading ? (
              <Skeleton height={240} radius={theme.radius.large} />
            ) : currentRulesHtml && shouldUseWebView(currentRulesHtml) ? (
              <View
                style={{
                  flex: 1,
                  minHeight: 0,
                  width: "100%",
                  paddingBottom: 2,
                }}
              >
                <EventHtmlContent
                  html={currentRulesHtml}
                  forceColorScheme="light"
                  fillContainer
                />
              </View>
            ) : (
              <ScrollView
                style={{ flex: 1 }}
                contentContainerStyle={{
                  gap: theme.spacing.md,
                  paddingRight: 4,
                  paddingBottom: theme.spacing.base,
                }}
                showsVerticalScrollIndicator
              >
                {currentRulesHtml ? (
                  <View style={{ paddingVertical: 4 }}>
                    <EventHtmlContent
                      html={currentRulesHtml}
                      forceColorScheme="light"
                    />
                  </View>
                ) : (
                  <Text variant="body" color="textMuted">
                    No rules content was supplied for this event.
                  </Text>
                )}
              </ScrollView>
            )}
          </Card>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

export default EventInfoScreen;
