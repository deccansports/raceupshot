import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Linking,
  Modal as RNModal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from "react-native";
import { Image } from "expo-image";
import {
  useGlobalSearchParams,
  useLocalSearchParams,
  useRouter,
} from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { getCountdownParts } from "@raceupshot/live-tracking-contracts/countdown";
import Animated, {
  FadeIn,
  FadeOut,
  SlideInUp,
  SlideOutDown,
} from "react-native-reanimated";

import { useTheme } from "@/core/theme";
import { formatCutoffSummary } from "@/core/utils";
import { isDevelopment } from "@/core/constants/env";
import {
  Badge,
  Button,
  Card,
  ErrorState,
  Icon,
  Skeleton,
  Text,
} from "@/shared/components";

import { EventHtmlContent, shouldUseWebView } from "./EventHtmlContent";
import {
  resolveCourseMaps,
  resolveLiveState,
  resolveRulesHtml,
  resolveTicketDefinitions,
} from "../eventDetailResolvers";
import {
  useEvent,
  useEventCourseCutoffs,
  useEventCourseIndex,
  useEventLive,
} from "../hooks/useEvents";
import { useEventTickets } from "../hooks/useEventExperience";
import { safeRouteEventId } from "../utils/eventRoute";
import { resolveValidGuidebook } from "../utils/guidebook";

const eventPlaceholder = require("../../../../assets/images/event-placeholder.jpg");

function firstText(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function toText(value: unknown): string | undefined {
  return firstText(value);
}

function formatContestCutoffLines(contests: unknown): string[] {
  if (!Array.isArray(contests)) return [];
  const lines: string[] = [];
  for (const contest of contests) {
    if (!contest || typeof contest !== "object") continue;
    const record = contest as Record<string, unknown>;
    const contestLabel =
      firstText(record.contestName, record.ticketName, record.name) ??
      "Contest";
    const cutoffLines = formatCutoffSummary(
      undefined,
      record.cutoffs as Record<string, unknown> | unknown[] | null | undefined,
    );
    const subCategories = Array.isArray(record.subCategories)
      ? record.subCategories
          .map((item) => {
            if (typeof item === "string") return item.trim();
            if (!item || typeof item !== "object") return undefined;
            const row = item as Record<string, unknown>;
            return firstText(row.name, row.label, row.title);
          })
          .filter((value): value is string => Boolean(value))
      : [];
    const details = [...subCategories, ...cutoffLines]
      .filter(Boolean)
      .join(" · ");
    if (details) lines.push(`${contestLabel}: ${details}`);
  }
  return lines;
}

function formatCountdown(
  dateLabel: string,
  now = Date.now(),
): string | undefined {
  const value = getCountdownParts(dateLabel, now);
  if (!value.valid) return undefined;
  if (value.isPast) return "Starting soon";
  const days = value.days;
  const hours = value.hours;
  const minutes = value.minutes;

  if (days > 0) return `Starts in ${days}d ${hours}h`;
  if (hours > 0) return `Starts in ${hours}h ${minutes}m`;
  return `Starts in ${minutes}m`;
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

function extractTicketDefinitionRows(
  payload: unknown,
): Record<string, unknown>[] {
  if (Array.isArray(payload)) return firstRecordArray(payload);
  if (!payload || typeof payload !== "object") return [];
  const record = payload as Record<string, unknown>;
  const data =
    record.data &&
    typeof record.data === "object" &&
    !Array.isArray(record.data)
      ? (record.data as Record<string, unknown>)
      : undefined;
  return firstRecordArray(
    record.ticketDefinitions,
    record.tickets,
    data?.ticketDefinitions,
    data?.tickets,
    data?.items,
  );
}

function formatTicketDefinitionCutoffLines(
  tickets: Record<string, unknown>[],
): string[] {
  return tickets.flatMap((ticket) => {
    const label =
      firstText(
        ticket.ticketName,
        ticket.name,
        ticket.title,
        ticket.contestName,
        ticket.categoryName,
      ) ?? "Ticket";
    const lines: string[] = [];
    const overall = firstText(
      ticket.cutoffHHMMSS,
      ticket.cutoffTime,
      ticket.cutoff,
      ticket.cumulativeCutoffTime,
      ticket.cumulativeCutoff,
    );
    if (overall) lines.push(`Overall: ${overall}`);
    lines.push(
      ...formatCutoffSummary(
        undefined,
        ticket.cutoffs as
          Record<string, unknown> | unknown[] | null | undefined,
      ),
    );
    if (Array.isArray(ticket.subCategories)) {
      for (const item of ticket.subCategories) {
        if (!item || typeof item !== "object") continue;
        const row = item as Record<string, unknown>;
        const cutoff = firstText(
          row.cutoffHHMMSS,
          row.cutoffTime,
          row.cutoff,
          row.cumulativeCutoffTime,
          row.cumulativeCutoff,
        );
        if (cutoff)
          lines.push(
            `${firstText(row.name, row.label, row.title) ?? "Subcategory"}: ${cutoff}`,
          );
      }
    }
    return lines.map((line) => `${label}: ${line}`);
  });
}

type CutoffDisplayGroup = {
  id: string;
  title: string;
  rows: { label: string; value: string }[];
};

function cutoffText(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value))
      return String(value);
  }
  return undefined;
}

function buildCutoffDisplayGroups(
  tickets: Record<string, unknown>[],
): CutoffDisplayGroup[] {
  const groups = tickets.flatMap((ticket, index) => {
    const title =
      firstText(
        ticket.ticketName,
        ticket.name,
        ticket.title,
        ticket.contestName,
        ticket.categoryName,
      ) ?? `Race ${index + 1}`;
    const normalizedTitle = title.toUpperCase();
    const cutoffs =
      ticket.cutoffs &&
      typeof ticket.cutoffs === "object" &&
      !Array.isArray(ticket.cutoffs)
        ? (ticket.cutoffs as Record<string, unknown>)
        : {};
    const id = String(
      ticket.id ?? ticket.ticketId ?? ticket.contestId ?? title,
    );

    if (
      normalizedTitle.includes("TRIATHLON") ||
      normalizedTitle.includes("BERGMAN 102") ||
      normalizedTitle.includes("OLYMPIC")
    ) {
      return [
        {
          id,
          title,
          rows: [
            {
              label: "Swim",
              value:
                cutoffText(cutoffs.swim, cutoffs.swim1, ticket.swimCutoff) ??
                "—",
            },
            {
              label: "Bike",
              value:
                cutoffText(cutoffs.bike, cutoffs.bike1, ticket.bikeCutoff) ??
                "—",
            },
            {
              label: "Run",
              value:
                cutoffText(
                  cutoffs.run,
                  cutoffs.run1,
                  cutoffs.run2,
                  ticket.runCutoff,
                ) ?? "—",
            },
          ],
        },
      ];
    }

    const subcategoryRows = recordArray(ticket.subCategories).flatMap((row) => {
      const value = cutoffText(
        row.cutoffHHMMSS,
        row.cutoffTime,
        row.cutoff,
        row.cumulativeCutoffTime,
        row.cumulativeCutoff,
      );
      return value
        ? [
            {
              label: firstText(row.name, row.label, row.title) ?? "Category",
              value,
            },
          ]
        : [];
    });
    const overall = cutoffText(
      ticket.cutoffHHMMSS,
      ticket.cutoffTime,
      ticket.cutoff,
      ticket.cumulativeCutoffTime,
      ticket.cumulativeCutoff,
    );
    const rows =
      subcategoryRows.length > 0
        ? subcategoryRows
        : overall
          ? [{ label: "Overall", value: overall }]
          : [];
    return rows.length > 0 ? [{ id, title, rows }] : [];
  });

  const deduped = new Map<string, CutoffDisplayGroup>();
  for (const group of groups) {
    const key = group.title
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, " ")
      .trim();
    const existing = deduped.get(key);
    if (!existing) {
      deduped.set(key, group);
      continue;
    }

    const mergedRows = existing.rows.map((row) => {
      const incoming = group.rows.find(
        (candidate) =>
          candidate.label.trim().toUpperCase() ===
          row.label.trim().toUpperCase(),
      );
      return row.value === "—" && incoming?.value && incoming.value !== "—"
        ? incoming
        : row;
    });
    for (const row of group.rows) {
      if (
        !mergedRows.some(
          (candidate) =>
            candidate.label.trim().toUpperCase() ===
            row.label.trim().toUpperCase(),
        )
      ) {
        mergedRows.push(row);
      }
    }
    deduped.set(key, { ...existing, rows: mergedRows });
  }

  return [...deduped.values()];
}

function firstNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const numeric = Number(value);
      if (Number.isFinite(numeric)) return numeric;
    }
  }
  return undefined;
}

function formatTemperatureValue(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value === "string") return value.trim() || undefined;
  if (typeof value === "number" && Number.isFinite(value))
    return `${Math.round(value)}°C`;
  if (typeof value !== "object") return undefined;

  const record = value as Record<string, unknown>;
  const celsius = firstNumber(
    record.celsius,
    record.c,
    record.tempC,
    record.temperatureC,
    record.value,
    record.current,
  );
  const fahrenheit = firstNumber(
    record.fahrenheit,
    record.f,
    record.tempF,
    record.temperatureF,
  );
  const summary = firstText(
    record.summary,
    record.label,
    record.description,
    record.text,
  );

  if (celsius != null && fahrenheit != null)
    return `${Math.round(celsius)}°C (${Math.round(fahrenheit)}°F)`;
  if (celsius != null) return `${Math.round(celsius)}°C`;
  if (fahrenheit != null) return `${Math.round(fahrenheit)}°F`;
  return summary || undefined;
}

function formatTemperatureDisplay(
  metrics: Record<string, unknown> | null | undefined,
) {
  if (!metrics) return [] as { label: string; value: string }[];
  const highAir = formatTemperatureValue(
    metrics.highAirTemperature ??
      metrics.highAirTemp ??
      metrics.airHigh ??
      metrics.airHighTemperature ??
      metrics.maxAirTemperature,
  );
  const lowAir = formatTemperatureValue(
    metrics.lowAirTemperature ??
      metrics.lowAirTemp ??
      metrics.airLow ??
      metrics.airLowTemperature ??
      metrics.minAirTemperature,
  );
  const water = formatTemperatureValue(
    metrics.waterTemperature ??
      metrics.averageWaterTemperature ??
      metrics.avgWaterTemperature ??
      metrics.waterTemp ??
      metrics.water,
  );

  return [
    highAir ? { label: "High Air Temperature", value: highAir } : undefined,
    lowAir ? { label: "Low Air Temperature", value: lowAir } : undefined,
    water ? { label: "Water Temperature", value: water } : undefined,
  ].filter(Boolean) as { label: string; value: string }[];
}

function formatCourseProfile(
  courseDetails: Record<string, unknown> | null | undefined,
): { label: string; value: string; icon: string }[] {
  if (!courseDetails) return [];
  const swim = firstText(
    courseDetails.swim,
    courseDetails.swimProfile,
    courseDetails.swimCourse,
    courseDetails.swimTerrain,
  );
  const bike = firstText(
    courseDetails.bike,
    courseDetails.bikeProfile,
    courseDetails.bikeCourse,
    courseDetails.bikeTerrain,
  );
  const run = firstText(
    courseDetails.run,
    courseDetails.runProfile,
    courseDetails.runCourse,
    courseDetails.runTerrain,
  );
  const run1 = firstText(
    courseDetails.run1,
    courseDetails.run1Profile,
    courseDetails.run1Course,
    courseDetails.run1Terrain,
  );
  const run2 = firstText(
    courseDetails.run2,
    courseDetails.run2Profile,
    courseDetails.run2Course,
    courseDetails.run2Terrain,
  );
  return [
    swim ? { label: "Swim", value: swim, icon: "🏊" } : undefined,
    run1 ? { label: "Run 1", value: run1, icon: "🏃" } : undefined,
    bike ? { label: "Bike", value: bike, icon: "🚴" } : undefined,
    run2 ? { label: "Run 2", value: run2, icon: "🏃" } : undefined,
    run ? { label: "Run", value: run, icon: "🏃" } : undefined,
  ].filter(Boolean) as { label: string; value: string; icon: string }[];
}

function formatAirport(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  return firstText(
    record.name,
    record.code,
    record.iata,
    record.iataCode,
    record.label,
    record.title,
    record.airport,
  );
}

type NormalizedTicketGroup = {
  label: string;
  tickets: {
    id: string;
    label: string;
    subcategories: string[];
  }[];
};

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

function isAgeCategory(value: unknown): boolean {
  return /^(\d{1,2}\s*-\s*\d{1,2}|ABOVE\s+\d{1,2})$/.test(
    normalizeCategoryName(value),
  );
}

function swimathonSubcategory(value: unknown): string {
  const normalized = normalizeCategoryName(value)
    .replace(/^BERGMAN\s+SWIMATHON(?:\s+[A-Z]+)?\s*-\s*/, "")
    .replace(/^BERGMAN\s+SWIMATHON\s*-\s*/, "")
    .replace(/^SWIMATHON(?:\s+[A-Z]+)?\s*-\s*/, "")
    .replace(/^SWIMATHON\s*-\s*/, "")
    .trim();
  if (
    !normalized ||
    /^BERGMAN\s+SWIMATHON(?:\s+[A-Z]+)?$/.test(normalized) ||
    isAgeCategory(normalized)
  )
    return "";
  if (/KIDS\s*500/.test(normalized) || /(^|\s)500\s*MTRS?\b/.test(normalized))
    return "KIDS 500 MTRS";
  if (/\b1\s*KM\b/.test(normalized)) return "1 KM";
  if (/\b2\s*KM\b/.test(normalized)) return "2 KM";
  if (/\b4\s*KM\b/.test(normalized)) return "4 KM";
  return "";
}

function swimathonParentName(value: unknown): string {
  const normalized = normalizeCategoryName(value);
  if (!normalized.includes("SWIMATHON")) return "";
  const withoutChild = normalized
    .replace(
      /\s*-\s*(KIDS\s*500\s*MTRS?|500\s*MTRS?|1\s*KM|2\s*KM|4\s*KM).*$/i,
      "",
    )
    .trim();
  if (!withoutChild || withoutChild === "SWIMATHON") return "BERGMAN SWIMATHON";
  if (/^BERGMAN\s+SWIMATHON/.test(withoutChild)) return withoutChild;
  return withoutChild.replace(/^SWIMATHON/, "BERGMAN SWIMATHON");
}

function recordArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is Record<string, unknown> =>
      Boolean(item) && typeof item === "object",
  );
}

function firstRecordArray(...values: unknown[]): Record<string, unknown>[] {
  for (const value of values) {
    const rows = recordArray(value);
    if (rows.length > 0) return rows;
  }
  return [];
}

function buildNormalizedTicketGroups(
  tickets: Record<string, unknown>[],
): NormalizedTicketGroup[] {
  const triathlonTickets = new Map<
    string,
    NormalizedTicketGroup["tickets"][number]
  >();
  const swimSubcategories = new Map<string, string>();
  let swimParentName = "BERGMAN SWIMATHON";

  for (const ticket of tickets) {
    const rawName = firstText(
      ticket.ticketName,
      ticket.name,
      ticket.title,
      ticket.contestName,
      ticket.categoryName,
      ticket.category,
    );
    if (!rawName || isAgeCategory(rawName)) continue;

    const normalizedName = normalizeCategoryName(rawName);
    const subcategoryRows = recordArray(ticket.subCategories)
      .map((sub) => firstText(sub.name, sub.ticketName, sub.title, sub.label))
      .filter(Boolean);
    const directSubcategory = firstText(
      ticket.subCategory,
      ticket.distance,
      ticket.distances,
    );
    const swimChildLabels = [rawName, directSubcategory, ...subcategoryRows]
      .map(swimathonSubcategory)
      .filter(Boolean);
    const isSwimathon =
      normalizedName.includes("SWIMATHON") || swimChildLabels.length > 0;

    if (isSwimathon) {
      const parentName = swimathonParentName(rawName);
      if (
        parentName &&
        (swimParentName === "BERGMAN SWIMATHON" ||
          parentName !== "BERGMAN SWIMATHON")
      ) {
        swimParentName = parentName;
      }
      for (const label of swimChildLabels) {
        swimSubcategories.set(categoryKey(label), label);
      }
      continue;
    }

    if (!/(TRIATHLON|BERGMAN 102|OLYMPIC)/.test(normalizedName)) continue;

    const label = normalizedName;
    const key = categoryKey(
      firstText(
        ticket.ticketId,
        ticket.id,
        ticket.contestId,
        ticket.providerContestUuid,
        label,
      ),
    );
    const nameKey = categoryKey(label);
    if (!triathlonTickets.has(key) && !triathlonTickets.has(nameKey)) {
      triathlonTickets.set(key, { id: key, label, subcategories: [] });
      triathlonTickets.set(nameKey, { id: key, label, subcategories: [] });
    }
  }

  const groups: NormalizedTicketGroup[] = [];
  if (triathlonTickets.size > 0) {
    const preferredOrder = [
      "BERGMAN 102 TRIATHLON",
      "BERGMAN OLYMPIC TRIATHLON",
    ];
    const dedupedTickets = [
      ...new Map(
        [...triathlonTickets.values()].map((ticket) => [
          categoryKey(ticket.label),
          ticket,
        ]),
      ).values(),
    ];
    groups.push({
      label: "TRIATHLON",
      tickets: dedupedTickets.sort((a, b) => {
        const ai = preferredOrder.indexOf(a.label);
        const bi = preferredOrder.indexOf(b.label);
        if (ai !== -1 || bi !== -1)
          return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
        return a.label.localeCompare(b.label);
      }),
    });
  }

  if (swimSubcategories.size > 0) {
    const subcategoryOrder = ["KIDS 500 MTRS", "1 KM", "2 KM", "4 KM"];
    groups.push({
      label: "SWIMMING",
      tickets: [
        {
          id: categoryKey(swimParentName).toLowerCase(),
          label: swimParentName,
          subcategories: [...swimSubcategories.values()].sort(
            (a, b) => subcategoryOrder.indexOf(a) - subcategoryOrder.indexOf(b),
          ),
        },
      ],
    });
  }

  return groups;
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
          firstText(
            record.label,
            record.name,
            record.title,
            record.day,
            record.discipline,
            record.category,
            record.event,
          ) ?? "Schedule";
        const time = firstText(
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
        const label = firstText(record.label, record.name, record.title) ?? key;
        const time = firstText(
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

function PremiumSheetModal({
  visible,
  title,
  onClose,
  children,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const { height: screenHeight } = useWindowDimensions();
  const sheetHeight = Math.round(screenHeight * 0.9);

  return (
    <RNModal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onClose}
    >
      <View style={styles.modalRoot}>
        <Animated.View
          entering={FadeIn.duration(160)}
          exiting={FadeOut.duration(120)}
          style={StyleSheet.absoluteFill}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close modal"
            style={styles.backdrop}
            onPress={onClose}
          />
        </Animated.View>
        <Animated.View
          entering={SlideInUp.duration(240)}
          exiting={SlideOutDown.duration(180)}
          style={[styles.sheet, { height: sheetHeight }]}
        >
          <View style={styles.dragHandleWrap}>
            <View style={styles.dragHandle} />
          </View>
          <View style={styles.sheetHeader}>
            <Text
              variant="headline"
              style={{ flex: 1, color: "#FFFFFF", fontWeight: "900" }}
            >
              {title}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close modal"
              onPress={onClose}
              style={styles.closeButton}
            >
              <Icon name="chevronDown" />
            </Pressable>
          </View>
          {children}
        </Animated.View>
      </View>
    </RNModal>
  );
}

function RulesContentModal({
  visible,
  html,
  onClose,
}: {
  visible: boolean;
  html: string;
  onClose: () => void;
}) {
  const { width } = useWindowDimensions();
  const rulesContentWidth = Math.max(0, width - 64);
  const useDocumentFrame = shouldUseWebView(html);
  return (
    <PremiumSheetModal
      title="Rules & Regulations"
      visible={visible}
      onClose={onClose}
    >
      {useDocumentFrame ? (
        <Card
          style={{
            flex: 1,
            minHeight: 0,
            marginHorizontal: 20,
            marginTop: 16,
            marginBottom: 2,
            backgroundColor: "#FFFFFF",
            borderRadius: 20,
            padding: 12,
            overflow: "hidden",
          }}
        >
          <EventHtmlContent
            html={html}
            forceColorScheme="light"
            availableWidth={rulesContentWidth}
            fillContainer
          />
        </Card>
      ) : (
        <ScrollView
          style={styles.sheetScroll}
          contentContainerStyle={styles.sheetScrollContent}
          showsVerticalScrollIndicator={false}
        >
          <Card
            style={{
              backgroundColor: "#FFFFFF",
              borderRadius: 20,
              padding: 12,
            }}
          >
            <EventHtmlContent
              html={html}
              forceColorScheme="light"
              availableWidth={rulesContentWidth}
            />
          </Card>
        </ScrollView>
      )}
    </PremiumSheetModal>
  );
}

function openUrl(url?: string) {
  if (!url) return;
  void Linking.openURL(url);
}

export function EventDetailsScreen() {
  const theme = useTheme();
  const { width: screenWidth } = useWindowDimensions();
  const useVerticalCourseProfile = screenWidth < 600;
  const router = useRouter();
  const { eventId } = useLocalSearchParams<{ eventId?: string | string[] }>();
  const { eventId: globalEventId } = useGlobalSearchParams<{
    eventId?: string | string[];
  }>();
  const id = safeRouteEventId(eventId, globalEventId) ?? "";
  const eventQuery = useEvent(id);
  const eventError = eventQuery.error;
  const event = eventQuery.event;
  // The live summary and full course index can be several megabytes. Event
  // Info already has its banner, tickets, course profile and schedule in the
  // primary event payload, so only fetch live supplements during an active race.
  const shouldLoadLiveSupplement = event?.status === "live";
  const liveEventQuery = useEventLive(id, shouldLoadLiveSupplement);
  const courseIndexQuery = useEventCourseIndex(id, shouldLoadLiveSupplement);
  const publicCutoffQuery = useEventCourseCutoffs(id, Boolean(event));
  const ticketsQuery = useEventTickets(id, Boolean(event));
  const isEventLoading = eventQuery.isLoading;
  const refetchEvent = eventQuery.refetch;
  const [rulesEventId, setRulesEventId] = useState<string | null>(null);
  const [cutoffOpen, setCutoffOpen] = useState(false);
  const [countdownNow, setCountdownNow] = useState(() => Date.now());
  const showRules = rulesEventId === id;
  const eventRecord =
    event?.raw && typeof event.raw === "object"
      ? (event.raw as Record<string, unknown>)
      : undefined;
  const ticketDefinitions = useMemo(
    () => resolveTicketDefinitions(event),
    [event],
  );
  const ticketsFromKv = useMemo(
    () => extractTicketDefinitionRows(ticketsQuery.data),
    [ticketsQuery.data],
  );
  const customContentHtml = firstText(
    event?.customContent,
    eventRecord?.customContent,
    eventRecord?.customContentHtml,
  );
  const disciplineSchedule =
    event?.disciplineSchedule ?? eventRecord?.disciplineSchedule;

  const countdownLabel =
    event?.status === "upcoming"
      ? formatCountdown(event.countdownTargetAt ?? event.startAt ?? "", countdownNow)
      : undefined;
  const countdownParts =
    event?.status === "upcoming"
      ? formatCountdownParts(event.countdownTargetAt ?? event.startAt ?? "", countdownNow)
      : undefined;
  const rulesHtml = resolveRulesHtml(event) ?? "";
  const guidebookTarget = resolveValidGuidebook(event)?.originalUrl;
  const primaryActionRoute =
    event?.status === "finished"
      ? "/event/[eventId]/results"
      : "/event/[eventId]/track";
  const showBroadcast =
    event?.status === "upcoming" || event?.status === "live";
  const timingConfig =
    eventRecord?.timingConfiguration &&
    typeof eventRecord.timingConfiguration === "object"
      ? (eventRecord.timingConfiguration as Record<string, unknown>)
      : undefined;
  const temperatureMetrics = (event?.temperatureMetrics ??
    eventRecord?.temperatureMetrics ??
    null) as Record<string, unknown> | null;
  const courseDetails = (event?.courseDetails ??
    eventRecord?.courseDetails ??
    null) as Record<string, unknown> | null;
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
    () => firstRecordArray(timingConfig?.contests, eventRecord?.contests),
    [timingConfig, eventRecord],
  );
  const ticketCategoryRows =
    ticketsFromKv.length > 0
      ? ticketsFromKv
      : ticketDefinitions.length > 0
        ? ticketDefinitions
        : courseMapTicketDefinitions.length > 0
          ? courseMapTicketDefinitions
          : timingFallbackTickets;
  const normalizedTicketGroups = useMemo(
    () => buildNormalizedTicketGroups(ticketCategoryRows),
    [ticketCategoryRows],
  );
  const ticketCutoffs = useMemo(() => {
    const rows = ticketsFromKv.length > 0 ? ticketsFromKv : ticketCategoryRows;
    return rows
      .map((ticket) => ({
        id: String(
          ticket.id ??
            ticket.ticketId ??
            ticket.contestId ??
            ticket.providerContestUuid ??
            ticket.name ??
            ticket.title ??
            "",
        ).trim(),
        label: String(
          ticket.ticketName ??
            ticket.name ??
            ticket.title ??
            ticket.contestName ??
            ticket.categoryName ??
            ticket.category ??
            "Ticket",
        ).trim(),
        cutoff:
          firstText(
            ticket.cutoffHHMMSS,
            ticket.cutoffTime,
            ticket.cutoff,
            ticket.cumulativeCutoffTime,
            ticket.cumulativeCutoff,
          ) ?? undefined,
      }))
      .filter((ticket) => Boolean(ticket.cutoff));
  }, [ticketCategoryRows, ticketsFromKv]);
  const ticketDefinitionCutoffSummary = useMemo(
    () =>
      formatTicketDefinitionCutoffLines(
        ticketsFromKv.length > 0 ? ticketsFromKv : ticketCategoryRows,
      ),
    [ticketCategoryRows, ticketsFromKv],
  );
  const cutoffDisplayGroups = useMemo(
    () =>
      buildCutoffDisplayGroups(
        ticketsFromKv.length > 0 ? ticketsFromKv : ticketCategoryRows,
      ),
    [ticketCategoryRows, ticketsFromKv],
  );
  const courseIndexCutoffRows = useMemo(() => {
    const contests = Array.isArray(courseIndexQuery.data?.courseIndex?.contests)
      ? courseIndexQuery.data.courseIndex.contests
      : [];
    return contests
      .flatMap((contest) =>
        (Array.isArray(contest.timingPoints) ? contest.timingPoints : []).map(
          (point) => ({
            label: firstText(point.label) ?? contest.name ?? "Split",
            cutoffMinutes: point.cutoffMinutes,
          }),
        ),
      )
      .filter((row) => row.cutoffMinutes != null);
  }, [courseIndexQuery.data]);
  const publicCutoffSummary = useMemo(
    () => formatContestCutoffLines(publicCutoffQuery.data?.contests),
    [publicCutoffQuery.data?.contests],
  );
  const cutoffSummary = useMemo(
    () =>
      ticketDefinitionCutoffSummary.length > 0
        ? ticketDefinitionCutoffSummary
        : publicCutoffSummary.length > 0
          ? publicCutoffSummary
          : formatCutoffSummary(
              event?.cutoffMinutes,
              courseIndexCutoffRows.length > 0
                ? courseIndexCutoffRows
                : ticketCutoffs.length > 0
                  ? ticketCutoffs
                  : event?.cutoffs,
            ),
    [
      event?.cutoffMinutes,
      event?.cutoffs,
      courseIndexCutoffRows,
      ticketCutoffs,
      publicCutoffSummary,
      ticketDefinitionCutoffSummary,
    ],
  );

  useEffect(() => {
    if (event?.status !== "upcoming") return;
    const interval = setInterval(() => setCountdownNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [event?.status, event?.startDate, event?.dateLabel]);
  const temperatureRows = useMemo(
    () => formatTemperatureDisplay(temperatureMetrics),
    [temperatureMetrics],
  );
  const courseProfileRows = useMemo(
    () => formatCourseProfile(courseDetails),
    [courseDetails],
  );
  const ticketCourseProfiles = useMemo(
    () => ticketCategoryRows
      .map((ticket, index) => {
        const details = ticket.courseDetails && typeof ticket.courseDetails === "object"
          ? ticket.courseDetails as Record<string, unknown>
          : null;
        return {
          id: firstText(ticket.id, ticket.ticketId, ticket.providerContestUuid) || `ticket-${index + 1}`,
          name: firstText(ticket.ticketName, ticket.name, ticket.contestName) || `Race ${index + 1}`,
          rows: formatCourseProfile(details),
        };
      })
      .filter((profile) => profile.rows.length > 0),
    [ticketCategoryRows],
  );
  const displayedCourseProfiles = ticketCourseProfiles.length > 0
    ? ticketCourseProfiles
    : courseProfileRows.length > 0
      ? [{ id: "event", name: "", rows: courseProfileRows }]
      : [];
  const nearestAirportLabel = formatAirport(eventRecord?.nearestAirport);
  const resolvedCourses = useMemo(
    () =>
      resolveCourseMaps({
        liveCourseIndex: courseIndexQuery.data,
        ticketDefinitions,
      }),
    [courseIndexQuery.data, ticketDefinitions],
  );
  const liveState = useMemo(
    () => (event ? resolveLiveState(event, liveEventQuery.data) : null),
    [event, liveEventQuery.data],
  );
  const disciplineScheduleRows =
    collectDisciplineScheduleRows(disciplineSchedule);
  const bannerUri = firstText(
    event?.photoUrl,
    event?.imageUri,
    eventRecord?.photoUrl,
    eventRecord?.imageUri,
    eventRecord?.imageUrl,
    eventRecord?.bannerImageUrl,
    eventRecord?.coverImageUrl,
  );
  const googleMapsUrl = firstText(
    eventRecord?.googleMapsUrl,
    eventRecord?.googleMaps,
    eventRecord?.mapsUrl,
  );
  const venueText = [
    eventRecord?.venueName,
    eventRecord?.address,
    event?.location,
  ]
    .map((value) => toText(value))
    .filter(Boolean)
    .join(" · ");
  const titleMeta = [event?.dateLabel, venueText, event?.discipline]
    .filter(Boolean)
    .join(" · ");

  useEffect(() => {
    if (!id) return;
    if (!isDevelopment) return;
    if (eventQuery.isError) {
      console.error("[event-details-route] Event detail load failed", {
        eventId: id,
        message:
          eventError instanceof Error ? eventError.message : String(eventError),
      });
    }
  }, [eventError, eventQuery.isError, id]);

  useEffect(() => {
    if (process.env.NODE_ENV === "production" || !event) return;
    console.log("[event-details]", {
      eventId: id,
      primaryLoaded: true,
      eventName: event.name,
      ticketCount: ticketDefinitions.length,
      courseCount: resolvedCourses.courses.length,
      courseSource: resolvedCourses.source,
      rulesAvailable: Boolean(rulesHtml),
      liveCourseAvailable: Boolean(courseIndexQuery.data),
      liveDataAvailable: Boolean(liveEventQuery.data),
    });
  }, [
    courseIndexQuery.data,
    event,
    id,
    liveEventQuery.data,
    liveState,
    resolvedCourses,
    rulesHtml,
    ticketDefinitions.length,
  ]);

  if (isEventLoading && !event) {
    return (
      <SafeAreaView
        style={{ flex: 1, backgroundColor: theme.colors.background }}
      >
        <View style={{ padding: theme.spacing.base, gap: theme.spacing.md }}>
          <Skeleton height={240} radius={theme.radius.xl} />
          <Skeleton height={84} radius={theme.radius.large} />
          <Skeleton height={220} radius={theme.radius.large} />
        </View>
      </SafeAreaView>
    );
  }

  if (!event) {
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
                : "The event route is no longer active."
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
          <View style={{ position: "relative" }}>
            <Image
              source={bannerUri ? { uri: bannerUri } : eventPlaceholder}
              placeholder={eventPlaceholder}
              cachePolicy="disk"
              transition={200}
              style={{
                width: "100%",
                aspectRatio: 1.85,
                backgroundColor: theme.colors.surface,
              }}
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
                onPress={() => router.replace("/")}
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 20,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: "rgba(0,0,0,0.45)",
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
          </View>

          <View style={{ padding: theme.spacing.base, gap: theme.spacing.sm }}>
            <Text variant="display">{event.name}</Text>
            <Button
              label={
                event.status === "finished"
                  ? "Official Results"
                  : "Live Tracking"
              }
              variant="primary"
              size="sm"
              fullWidth
              onPress={() => {
                if (!id) return;
                router.push({
                  pathname: primaryActionRoute,
                  params: { eventId: id },
                });
              }}
            />
            {showBroadcast ? (
              <Button
                label="Live Broadcast"
                variant="secondary"
                size="sm"
                fullWidth
                onPress={() => {
                  if (!id) return;
                  router.push({
                    pathname: "/event/[eventId]/broadcast",
                    params: { eventId: id },
                  });
                }}
              />
            ) : null}
            <Text variant="bodySmall" color="textMuted">
              {titleMeta || "Event details from backend"}
            </Text>
            {event.distances ? (
              <Text variant="body" color="textSecondary">
                {event.distances}
              </Text>
            ) : null}
          </View>
        </Card>

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
              <Text variant="headline">
                {countdownLabel ??
                  (event.status === "live"
                    ? "Live now"
                    : event.status === "finished"
                      ? "Completed"
                      : "Scheduled")}
              </Text>
            </View>
          </View>
          {countdownParts ? (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
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
                    backgroundColor: "#151515",
                    borderWidth: 1,
                    borderColor: "#3B2A1B",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 4,
                  }}
                >
                  <Text
                    variant="display"
                    style={{
                      color: "#FF7A00",
                      fontWeight: "900",
                      lineHeight: 34,
                    }}
                  >
                    {item.value}
                  </Text>
                  <Text
                    variant="caption"
                    style={{
                      color: "#CFCFCF",
                      fontWeight: "800",
                      letterSpacing: 1,
                    }}
                  >
                    {item.label}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
        </Card>
        <Card
          style={{
            width: "100%",
            alignSelf: "stretch",
            gap: 6,
            paddingVertical: 12,
          }}
        >
          <Text
            variant="caption"
            color="textMuted"
            style={{ letterSpacing: 0.6, textTransform: "uppercase" }}
          >
            Venue
          </Text>
          <Text variant="headline" numberOfLines={1}>
            {String(
              eventRecord?.venueName ?? event.location ?? "From event data",
            )}
          </Text>
          {eventRecord?.address ? (
            <Text variant="bodySmall" color="textSecondary" numberOfLines={2}>
              {String(eventRecord.address)}
            </Text>
          ) : null}
          {nearestAirportLabel ? (
            <Text variant="bodySmall" color="textSecondary" numberOfLines={1}>
              Nearest airport: {nearestAirportLabel}
            </Text>
          ) : null}
          {googleMapsUrl ? (
            <Button
              label="Open Maps"
              variant="ghost"
              size="sm"
              onPress={() => openUrl(googleMapsUrl)}
            />
          ) : null}
        </Card>

        {temperatureRows.length > 0 ? (
          <Card style={{ gap: theme.spacing.sm }}>
            <Text variant="headline">Event information</Text>
            <View style={{ gap: theme.spacing.sm }}>
              {temperatureRows.map((row) => (
                <View key={row.label} style={styles.infoRow}>
                  <Text variant="bodySmall" color="textMuted">
                    {row.label}
                  </Text>
                  <Text
                    variant="bodySmall"
                    color="textPrimary"
                    style={styles.infoValue}
                  >
                    {row.value}
                  </Text>
                </View>
              ))}
            </View>
          </Card>
        ) : null}

        {displayedCourseProfiles.length > 0 ? (
          <>
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
                {displayedCourseProfiles.length > 0 ? (
                  <Pressable
                    onPress={() => setCutoffOpen(true)}
                    style={{
                      paddingHorizontal: 12,
                      paddingVertical: 8,
                      borderRadius: 999,
                      backgroundColor: "#0B4EA2",
                      borderWidth: 1,
                      borderColor: "rgba(255,255,255,0.22)",
                      shadowColor: "#0B4EA2",
                      shadowOpacity: 0.28,
                      shadowRadius: 10,
                      shadowOffset: { width: 0, height: 4 },
                      elevation: 3,
                    }}
                  >
                    <Text
                      variant="caption"
                      style={{
                        color: "#FFFFFF",
                        fontWeight: "800",
                        letterSpacing: 0.4,
                      }}
                    >
                      Cutoffs
                    </Text>
                  </Pressable>
                ) : null}
              </View>
              {displayedCourseProfiles.map((profile) => (
                <View key={profile.id} style={{ gap: 8 }}>
                  {profile.name ? <Text variant="bodySmall" style={{ fontWeight: "800" }}>{profile.name}</Text> : null}
                  <View
                    style={{
                      flexDirection: useVerticalCourseProfile ? "column" : "row",
                      flexWrap: "nowrap",
                      gap: 8,
                    }}
                  >
                    {profile.rows.map((row) => (
                      <View
                        key={`${profile.id}-${row.label}`}
                        style={[
                          styles.courseRow,
                          {
                            flex: useVerticalCourseProfile ? undefined : 1,
                            width: useVerticalCourseProfile ? "100%" : undefined,
                            paddingVertical: useVerticalCourseProfile ? 10 : 8,
                          },
                        ]}
                      >
                        <View style={styles.courseIconWrap}>
                          <Text variant="body">{row.icon}</Text>
                        </View>
                        <View
                          style={{
                            flex: 1,
                            minWidth: 0,
                            alignItems: useVerticalCourseProfile ? "flex-start" : "center",
                            gap: 2,
                          }}
                        >
                          <Text variant="caption" color="textMuted" style={{ fontWeight: "700" }}>{row.label}</Text>
                          <Text
                            variant="bodySmall"
                            color="textPrimary"
                            style={{
                              flexShrink: 1,
                              textAlign: useVerticalCourseProfile ? "left" : "center",
                              fontWeight: "700",
                            }}
                          >
                            {row.value}
                          </Text>
                        </View>
                      </View>
                    ))}
                  </View>
                </View>
              ))}
            </Card>

            {customContentHtml ? (
              <Card style={{ gap: theme.spacing.sm }}>
                <Text variant="headline">Race Details</Text>
                <EventHtmlContent html={customContentHtml} />
              </Card>
            ) : null}

            {disciplineScheduleRows.length > 0 ? (
              <Card style={{ gap: theme.spacing.sm }}>
                <Text variant="headline">Discipline Schedule</Text>
                <View style={{ gap: theme.spacing.xs }}>
                  {disciplineScheduleRows.map((line) => (
                    <Text key={line} variant="bodySmall" color="textSecondary">
                      {line}
                    </Text>
                  ))}
                </View>
              </Card>
            ) : null}
          </>
        ) : null}

        <Card style={{ gap: theme.spacing.sm }}>
          <Text variant="headline">Ticket categories</Text>
          {ticketCutoffs.length > 0 ? (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {ticketCutoffs.map((ticket) => (
                <Badge
                  key={ticket.id || ticket.label}
                  label={`${ticket.label}: ${ticket.cutoff}`}
                  variant="neutral"
                />
              ))}
            </View>
          ) : null}
          {normalizedTicketGroups.length > 0 ? (
            <View style={{ gap: theme.spacing.sm }}>
              {normalizedTicketGroups.map((group) => (
                <View key={group.label} style={{ gap: theme.spacing.xs }}>
                  <Text variant="label">{group.label}</Text>
                  {group.tickets.map((ticket) => (
                    <View key={ticket.id} style={{ gap: 6 }}>
                      <Text variant="body" color="textSecondary">
                        {ticket.label}
                      </Text>
                      {ticket.subcategories.length > 0 ? (
                        <View
                          style={{
                            flexDirection: "row",
                            flexWrap: "wrap",
                            gap: theme.spacing.xs,
                          }}
                        >
                          {ticket.subcategories.map((subcategory) => (
                            <Badge
                              key={`${ticket.id}-${subcategory}`}
                              label={subcategory}
                              variant="neutral"
                            />
                          ))}
                        </View>
                      ) : null}
                    </View>
                  ))}
                </View>
              ))}
            </View>
          ) : (
            <Text variant="bodySmall" color="textMuted">
              No ticket categories were supplied in event data.
            </Text>
          )}
        </Card>

        <RNModal
          visible={cutoffOpen}
          transparent
          statusBarTranslucent
          hardwareAccelerated
          animationType="fade"
          onRequestClose={() => setCutoffOpen(false)}
        >
          <View
            style={{
              flex: 1,
              justifyContent: "center",
              padding: theme.spacing.base,
            }}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close cutoff details"
              onPress={() => setCutoffOpen(false)}
              style={[
                StyleSheet.absoluteFill,
                { backgroundColor: "rgba(0,0,0,0.4)" },
              ]}
            />
            <View
              style={{
                width: "100%",
                maxHeight: "88%",
                backgroundColor: theme.colors.surfaceElevated,
                borderRadius: theme.radius.large,
                padding: theme.spacing.base,
                gap: theme.spacing.sm,
                overflow: "hidden",
              }}
            >
              <Text variant="headline">Cutoff details</Text>
              {cutoffDisplayGroups.length > 0 ? (
                <ScrollView
                  style={{ flexShrink: 1 }}
                  nestedScrollEnabled
                  scrollEnabled
                  directionalLockEnabled
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator
                  contentContainerStyle={{
                    gap: theme.spacing.sm,
                    paddingBottom: theme.spacing.md,
                  }}
                >
                  {cutoffDisplayGroups.map((group) => (
                    <View
                      key={group.id}
                      style={{
                        borderWidth: 1,
                        borderColor: theme.colors.border,
                        borderRadius: theme.radius.medium,
                        padding: theme.spacing.md,
                        gap: theme.spacing.sm,
                      }}
                    >
                      <Text variant="label" style={{ fontWeight: "900" }}>
                        {group.title}
                      </Text>
                      {group.rows.map((row) => (
                        <View
                          key={`${group.id}-${row.label}`}
                          style={{
                            flexDirection: "row",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: theme.spacing.md,
                          }}
                        >
                          <Text variant="bodySmall" color="textSecondary">
                            {row.label}
                          </Text>
                          <Text
                            variant="bodySmall"
                            style={{ fontWeight: "900" }}
                          >
                            {row.value}
                          </Text>
                        </View>
                      ))}
                    </View>
                  ))}
                  <View
                    style={{
                      borderRadius: theme.radius.medium,
                      padding: theme.spacing.md,
                      gap: theme.spacing.sm,
                      backgroundColor: theme.colors.surface,
                      borderWidth: 1,
                      borderColor: theme.colors.border,
                    }}
                  >
                    <Text variant="bodySmall" color="textSecondary">
                      <Text variant="bodySmall" style={{ fontWeight: "900" }}>
                        All cut-off times are cumulative
                      </Text>
                      {
                        ", measured from the athlete’s official race start time. Athletes must complete each stage within the specified cumulative cut-off to continue in the race."
                      }
                    </Text>
                    <Text variant="bodySmall" color="textSecondary">
                      <Text variant="bodySmall" style={{ fontWeight: "900" }}>
                        Cut-off times are subject to change
                      </Text>
                      {
                        " at the sole discretion of the Race Director based on weather, course conditions, safety requirements, or other operational considerations. The Race Director’s decision is final."
                      }
                    </Text>
                  </View>
                </ScrollView>
              ) : cutoffSummary.length > 0 ? (
                <ScrollView
                  style={{ flexShrink: 1 }}
                  nestedScrollEnabled
                  showsVerticalScrollIndicator
                  contentContainerStyle={{ gap: 6, paddingBottom: 8 }}
                >
                  {cutoffSummary.map((line) => (
                    <Text key={line} variant="bodySmall" color="textSecondary">
                      {line}
                    </Text>
                  ))}
                </ScrollView>
              ) : (
                <Text variant="bodySmall" color="textMuted">
                  No cutoff data available.
                </Text>
              )}
            </View>
          </View>
        </RNModal>

        <Card style={{ gap: theme.spacing.md }}>
          <Text variant="headline">Race details</Text>
          <View style={{ gap: theme.spacing.sm }}>
            <Button
              label="Rules & Regulations"
              variant="primary"
              size="sm"
              fullWidth
              onPress={() => setRulesEventId(id)}
            />
            <Button
              label="Athlete Guidebook"
              variant={guidebookTarget ? "secondary" : "ghost"}
              size="sm"
              fullWidth
              disabled={!guidebookTarget}
              onPress={() => {
                if (!guidebookTarget) return;
                if (!id) return;
                router.push({
                  pathname: "/event/[eventId]/guidebook",
                  params: {
                    eventId: id,
                    url: guidebookTarget,
                    title: `${event.name} Athlete Guidebook`,
                  },
                });
              }}
            />
            {!guidebookTarget ? (
              <Text variant="bodySmall" color="textMuted">
                Athlete Guidebook — Yet to be published.
              </Text>
            ) : null}
          </View>
        </Card>

        {event.status === "finished" ? (
          <View style={{ gap: theme.spacing.sm }}>
            <Button
              label="Official Results"
              variant="ghost"
              size="sm"
              fullWidth
              onPress={() => {
                if (!id) return;
                router.push({
                  pathname: primaryActionRoute,
                  params: { eventId: id },
                });
              }}
            />
          </View>
        ) : null}
      </ScrollView>

      {showRules ? (
        <RulesContentModal
          visible
          html={rulesHtml}
          onClose={() => setRulesEventId(null)}
        />
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  modalRoot: {
    flex: 1,
    justifyContent: "flex-end",
  },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  sheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    overflow: "hidden",
    backgroundColor: "#0B1220",
  },
  dragHandleWrap: {
    alignItems: "center",
    paddingTop: 10,
    paddingBottom: 8,
  },
  dragHandle: {
    width: 44,
    height: 5,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.28)",
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 20,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.12)",
  },
  closeButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  sheetScroll: {
    flex: 1,
  },
  sheetScrollContent: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 28,
    gap: 16,
  },
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
  },
  infoValue: {
    textAlign: "right",
    flexShrink: 1,
  },
  courseRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    padding: 14,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  courseIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
  },
});

export default EventDetailsScreen;
