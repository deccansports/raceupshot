import { useRouter } from "expo-router";
import {
  AppState,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  Switch,
  View,
  type AppStateStatus,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Image } from "expo-image";
import Animated, { FadeInDown } from "react-native-reanimated";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import {
  repositories,
  type AthleteDashboard,
  type AthleteDashboardRegistration,
  type TrackingVisibility,
} from "@/core/repositories";
import type { ApiError } from "@/core/types";
import { useTheme } from "@/core/theme";
import { queryClient } from "@/core/services/query/queryClient";
import { queryKeys } from "@/core/services/query/queryKeys";
import { getCountryFlagEmoji } from "@/core/utils";
import { useAuth } from "@/features/auth";
import {
  Avatar,
  Badge,
  Button,
  Card,
  EmptyState,
  Icon,
  MobileAnnouncementStrip,
  Modal,
  SectionHeader,
  SearchBar,
  Text,
} from "@/shared/components";
import { safeRouteEventId } from "@/features/events/utils/eventRoute";

import { LoadingStack } from "./DashboardPrimitives";
import { useAthleteDashboard } from "../hooks/useMobileAggregates";

// Metro requires a static CommonJS asset reference for bundled images.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const LOGIN_MARK = require("../../../../assets/images/favicon.png");
const SHOW_RANKING_SECTIONS = false;

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    const candidate = text(value);
    if (candidate) return candidate;
  }
  return "";
}

function recordText(value: unknown, keys: string[]): string {
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const candidate = text(record[key]);
    if (candidate) return candidate;
  }
  return "";
}

function countryFlag(value: unknown): string {
  const raw = text(value);
  const shared = getCountryFlagEmoji(raw);
  if (shared) return shared;
  const code =
    raw.length === 2
      ? raw.toUpperCase()
      : raw.toLowerCase() === "india"
        ? "IN"
        : "";
  if (!/^[A-Z]{2}$/.test(code)) return "";
  return String.fromCodePoint(
    ...Array.from(code).map((char) => 127397 + char.charCodeAt(0)),
  );
}

function toDate(value: unknown): Date | null {
  const candidate = text(value);
  if (!candidate) return null;
  const parsed = new Date(candidate);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatDate(value: unknown): string {
  const date = toDate(value);
  if (!date) return "Date TBD";
  return date.toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

const MONTH_INDEX: Record<string, number> = {
  jan: 0,
  january: 0,
  feb: 1,
  february: 1,
  mar: 2,
  march: 2,
  apr: 3,
  april: 3,
  may: 4,
  jun: 5,
  june: 5,
  jul: 6,
  july: 6,
  aug: 7,
  august: 7,
  sep: 8,
  sept: 8,
  september: 8,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11,
};

function inferDateFromName(value: unknown): Date | null {
  const source = text(value).toLowerCase();
  const yearMatch = source.match(/\b(20\d{2})\b/);
  if (!yearMatch) return null;
  const year = Number(yearMatch[1]);
  const monthKey = Object.keys(MONTH_INDEX).find((key) =>
    new RegExp(`\\b${key}\\b`, "i").test(source),
  );
  return new Date(year, monthKey ? MONTH_INDEX[monthKey] : 11, 1);
}

function isUpcomingRegistration(item: AthleteDashboardRegistration): boolean {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const date =
    toDate(firstText(item.eventDate, item.date)) ??
    inferDateFromName(firstText(item.eventName, item.event));
  if (!date) return true;
  return date >= today;
}

function visibilityLabel(value: unknown): TrackingVisibility {
  const normalized = text(value).toUpperCase();
  if (normalized === "ANONYMOUS") return "ANONYMOUS";
  return "PUBLIC";
}

function visibilityStatusMessage(value: unknown): string {
  const visibility = visibilityLabel(value);
  if (visibility === "ANONYMOUS") {
    return "Your live tracking is ANONYMOUS. You remain visible to yourself and race officials, while public tracking/search hides you and public leaderboards show only Anonymous without a bib.";
  }
  return "Your live tracking is currently PUBLIC. Everyone can search for you, follow your race.";
}

function normalizeRegistration(
  item: AthleteDashboardRegistration | Record<string, unknown>,
): AthleteDashboardRegistration {
  return {
    ...item,
    id: firstText(recordText(item, ["id"]), recordText(item, ["eventId"])),
    eventId: recordText(item, ["eventId"]),
    bookingId: recordText(item, ["bookingId"]),
    event: recordText(item, ["eventName", "event", "name"]) || "Event",
    eventName: recordText(item, ["eventName", "event", "name"]) || "Event",
    date: recordText(item, ["eventDate", "date", "dateLabel"]),
    eventDate: recordText(item, ["eventDate", "date", "dateLabel"]),
    contest: recordText(item, [
      "ticketName",
      "contestName",
      "contest",
      "selectedSubCategory",
      "categoryName",
      "category",
    ]),
    contestName: recordText(item, [
      "ticketName",
      "contestName",
      "contest",
      "selectedSubCategory",
      "categoryName",
      "category",
    ]),
    bib: recordText(item, ["bib", "bibNumber", "athleteBibNumber"]),
    status: recordText(item, [
      "ticketStatus",
      "registrationStatus",
      "status",
      "statusNormalized",
    ]),
    registrationStatus: recordText(item, [
      "ticketStatus",
      "registrationStatus",
      "status",
      "statusNormalized",
    ]),
    venueName: recordText(item, ["venueName", "city", "state", "country"]),
    state: recordText(item, ["state"]),
    country: recordText(item, ["country"]),
  } as AthleteDashboardRegistration;
}

function registrationKey(item: AthleteDashboardRegistration): string {
  const eventId = firstText(item.eventId, item.id, item.eventName, item.event);
  const bookingId = firstText(item.bookingId);
  if (eventId && bookingId) return `${eventId}:${bookingId}`;
  return firstText(
    bookingId,
    eventId,
    item.id,
    item.eventName,
    item.event,
    item.date,
    item.eventDate,
  );
}

function trackRouteParams(
  item: AthleteDashboardRegistration,
  eventId: string,
  userId?: string,
) {
  const photo = firstText(
    recordText(item, [
      "photoUrl",
      "profilePhotoUrl",
      "photoURL",
      "displayPhoto",
      "profileUrl",
      "profileURL",
    ]),
  );
  return {
    eventId,
    bib: firstText(item.bib),
    athleteUid: firstText(recordText(item, ["athleteUid"]), userId),
    bookingId: firstText(item.bookingId),
    participantUuid: firstText(recordText(item, ["participantUuid"])),
    providerUuid: firstText(recordText(item, ["providerUuid"])),
    providerAthleteUuid: firstText(recordText(item, ["providerAthleteUuid"])),
    providerTimingUuid: firstText(recordText(item, ["providerTimingUuid"])),
    providerRecordId: firstText(recordText(item, ["providerRecordId"])),
    name: firstText(
      recordText(item, ["athleteName", "displayName", "fullName", "name"]),
    ),
    category: firstText(item.contestName, item.contest),
    club: firstText(recordText(item, ["club", "clubName"])),
    photoUrl: photo,
    profilePhotoUrl: photo,
    photoURL: photo,
    displayPhoto: photo,
  };
}

function DashboardShell({ children }: { children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: theme.colors.background }}
      edges={["top"]}
    >
      {children}
    </SafeAreaView>
  );
}

function InfoPill({ label, value }: { label: string; value: string }) {
  const theme = useTheme();
  return (
    <View
      style={{
        minWidth: 118,
        flexGrow: 1,
        flexBasis: "30%",
        gap: 4,
        borderRadius: theme.radius.medium,
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.18)",
        backgroundColor: "rgba(255,255,255,0.08)",
        padding: theme.spacing.sm,
      }}
    >
      <Text variant="caption" style={{ color: "rgba(255,255,255,0.68)" }}>
        {label.toUpperCase()}
      </Text>
      <Text
        variant="headline"
        style={{ color: theme.colors.textInverse }}
        numberOfLines={1}
      >
        {value}
      </Text>
    </View>
  );
}

function RegistrationInfoBlock({
  label,
  value,
  accent,
}: {
  label: string;
  value?: string;
  accent?: boolean;
}) {
  const theme = useTheme();
  if (!value) return null;
  return (
    <View
      style={{
        flexGrow: 1,
        flexBasis: "30%",
        minWidth: 90,
        gap: 3,
        borderRadius: theme.radius.medium,
        borderWidth: 1,
        borderColor: accent ? `${theme.colors.accent}55` : theme.colors.border,
        backgroundColor: accent
          ? `${theme.colors.accent}10`
          : theme.colors.surfaceSunken,
        paddingHorizontal: 9,
        paddingVertical: 8,
      }}
    >
      <Text variant="caption" color="textMuted">
        {label.toUpperCase()}
      </Text>
      <Text variant={accent ? "headline" : "body"} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

function RegistrationTableRow({
  item,
  onOpenEvent,
  onTrack,
}: {
  item: AthleteDashboardRegistration;
  onOpenEvent: () => void;
  onTrack: () => void;
}) {
  const theme = useTheme();
  const eventId = firstText(item.eventId, item.id);
  const bookingId = firstText(item.bookingId, recordText(item, ["bookingId"]));
  const eventName = firstText(item.eventName, item.event);
  const eventDate = formatDate(firstText(item.eventDate, item.date));
  const eventPlace = firstText(item.state, item.country, item.venueName);
  const ticketName =
    firstText(
      item.contestName,
      item.contest,
      recordText(item, ["ticketName"]),
    ) || "Ticket";
  const bibNumber =
    firstText(item.bib, recordText(item, ["bibNumber"])) || "Not assigned";
  return (
    <Card
      padded={false}
      style={{ overflow: "hidden", borderRadius: theme.radius.large }}
    >
      <View
        style={{
          gap: theme.spacing.sm,
          padding: theme.spacing.sm,
          backgroundColor: theme.colors.surfaceElevated,
        }}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "flex-start",
            gap: theme.spacing.sm,
          }}
        >
          <View
            style={{
              width: 38,
              height: 38,
              borderRadius: theme.radius.medium,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: `${theme.colors.accent}14`,
            }}
          >
            <Icon name="calendar" color="accent" size={19} />
          </View>
          <View style={{ flex: 1, gap: 8 }}>
            <View
              style={{
                flexDirection: "row",
                flexWrap: "wrap",
                alignItems: "center",
                gap: theme.spacing.xs,
              }}
            >
              <Text
                variant="caption"
                style={{
                  color: "#D18A00",
                  fontWeight: "900",
                  letterSpacing: 1.1,
                }}
              >
                UPCOMING REGISTERED EVENT
              </Text>
            </View>
            <Text variant="headline" numberOfLines={2}>
              {eventName}
            </Text>
            <View
              style={{
                flexDirection: "row",
                flexWrap: "wrap",
                gap: theme.spacing.xs,
              }}
            >
              <View
                style={{ flexDirection: "row", alignItems: "center", gap: 5 }}
              >
                <Icon name="clock" color="textMuted" size={14} />
                <Text variant="bodySmall" color="textMuted">
                  {eventDate}
                </Text>
              </View>
              {eventPlace ? (
                <View
                  style={{ flexDirection: "row", alignItems: "center", gap: 5 }}
                >
                  <Text variant="bodySmall" color="textMuted">
                    ·
                  </Text>
                  <Icon name="location" color="textMuted" size={14} />
                  <Text variant="bodySmall" color="textMuted">
                    {eventPlace}
                  </Text>
                </View>
              ) : null}
            </View>
          </View>
        </View>

        <View
          style={{
            flexDirection: "row",
            flexWrap: "wrap",
            gap: theme.spacing.sm,
          }}
        >
          <RegistrationInfoBlock label="Your Ticket" value={ticketName} />
          <RegistrationInfoBlock
            label="BIB No"
            value={bibNumber}
            accent={bibNumber !== "Not assigned"}
          />
          <RegistrationInfoBlock label="Booking ID" value={bookingId || "—"} />
          <RegistrationInfoBlock
            label="Status"
            value={firstText(item.registrationStatus, item.status) || "Active"}
          />
        </View>
      </View>

      <View
        style={{
          flexDirection: "row",
          gap: theme.spacing.sm,
          borderTopWidth: 1,
          borderTopColor: theme.colors.border,
          backgroundColor: theme.colors.surface,
          padding: theme.spacing.sm,
        }}
      >
        <View style={{ flex: 1 }}>
          <Button
            label="Event"
            size="sm"
            variant="secondary"
            disabled={!eventId}
            fullWidth
            onPress={onOpenEvent}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Button
            label="Live Tracking"
            size="sm"
            variant="primary"
            disabled={!eventId}
            fullWidth
            onPress={onTrack}
          />
        </View>
      </View>
    </Card>
  );
}

function AccountPrivacyCard({
  visibility,
  updating,
  error,
  onChange,
}: {
  visibility: TrackingVisibility;
  updating: boolean;
  error?: string | null;
  onChange: (visibility: TrackingVisibility) => void;
}) {
  const theme = useTheme();
  return (
    <Card style={{ gap: theme.spacing.sm, padding: theme.spacing.md }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: theme.spacing.sm,
          minWidth: 0,
        }}
      >
        <View
          style={{
            width: 40,
            height: 40,
            borderRadius: theme.radius.medium,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor:
              visibility === "PUBLIC"
                ? `${theme.colors.success}18`
                : `${theme.colors.danger}18`,
          }}
        >
          <Icon
            name={visibility === "ANONYMOUS" ? "eyeOff" : "eye"}
            color={visibility === "PUBLIC" ? "success" : "danger"}
            size={18}
          />
        </View>
        <View style={{ flex: 1, gap: 1, minWidth: 0 }}>
          <Text variant="headline" numberOfLines={1}>
            Live Tracking Visibility
          </Text>
          <Text variant="bodySmall" color="textMuted" numberOfLines={2}>
            Account-wide setting for how spectators see your live timing.
          </Text>
        </View>
        <Badge
          label={visibility === "ANONYMOUS" ? "Anonymous" : "Public"}
          variant={visibility === "PUBLIC" ? "success" : "danger"}
        />
      </View>

      <Text variant="bodySmall" color="textSecondary" numberOfLines={2}>
        Changes apply across public live tracking, search, maps, leaderboards,
        athlete modal, replay, and results.
      </Text>

      <Card
        elevated={false}
        style={{
          gap: theme.spacing.xs,
          backgroundColor: theme.colors.surfaceSunken,
          padding: theme.spacing.sm,
        }}
      >
        <Text variant="bodySmall" color="textSecondary" numberOfLines={3}>
          {visibilityStatusMessage(visibility)}
        </Text>
      </Card>

      {error ? (
        <Text variant="bodySmall" color="danger">
          {error}
        </Text>
      ) : null}

      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: theme.spacing.md,
          borderRadius: theme.radius.large,
          borderWidth: 1,
          borderColor:
            visibility === "PUBLIC"
              ? `${theme.colors.success}99`
              : `${theme.colors.danger}99`,
          backgroundColor:
            visibility === "PUBLIC"
              ? `${theme.colors.success}12`
              : `${theme.colors.danger}12`,
          paddingHorizontal: theme.spacing.md,
          paddingVertical: theme.spacing.sm,
          opacity: updating ? 0.7 : 1,
        }}
      >
        <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
          <Text variant="headline" style={{ fontWeight: "900" }}>
            {visibility === "PUBLIC" ? "Public" : "Anonymous"}
          </Text>
          <Text variant="bodySmall" color="textMuted">
            {visibility === "PUBLIC"
              ? "Your identity and race progress are visible."
              : "Your race remains visible while identity details are hidden."}
          </Text>
        </View>
        <Switch
          accessibilityLabel="Public live tracking visibility"
          accessibilityHint="Turn off to make your live tracking anonymous"
          disabled={updating}
          value={visibility === "PUBLIC"}
          onValueChange={(enabled) =>
            onChange(enabled ? "PUBLIC" : "ANONYMOUS")
          }
          trackColor={{
            false: `${theme.colors.danger}99`,
            true: `${theme.colors.success}99`,
          }}
          thumbColor={
            visibility === "PUBLIC" ? theme.colors.success : theme.colors.danger
          }
          ios_backgroundColor={`${theme.colors.danger}99`}
        />
      </View>
    </Card>
  );
}

function BelMetric({
  label,
  value,
  dark = true,
}: {
  label: string;
  value: string;
  dark?: boolean;
}) {
  const theme = useTheme();
  return (
    <View
      style={{
        flexGrow: 1,
        flexBasis: "46%",
        minWidth: 132,
        gap: 5,
        padding: theme.spacing.sm,
        borderRadius: theme.radius.medium,
        borderWidth: 1,
        borderColor: dark ? "rgba(255,255,255,0.13)" : theme.colors.border,
        backgroundColor: dark
          ? "rgba(255,255,255,0.08)"
          : theme.colors.surfaceSunken,
      }}
    >
      <Text
        variant="caption"
        style={{
          color: dark ? "rgba(255,255,255,0.7)" : theme.colors.textMuted,
        }}
      >
        {label.toUpperCase()}
      </Text>
      <Text
        variant="title"
        style={{ color: dark ? "#FFFFFF" : theme.colors.textPrimary }}
      >
        {value}
      </Text>
    </View>
  );
}

function BelProgressCard({ dashboard }: { dashboard?: AthleteDashboard }) {
  const theme = useTheme();
  const bel = dashboard?.bel;
  const season = text(bel?.season) || String(new Date().getFullYear());
  const tier =
    firstText(bel?.tier, bel?.status, dashboard?.athlete.belTier) || "No Tier";
  const points =
    firstText(
      bel?.points,
      dashboard?.statistics?.currentSeasonPoints,
      dashboard?.statistics?.totalBelPoints,
    ) || "0";
  const starts = Number(bel?.starts ?? 0) || 0;
  const discount =
    tier === "Gold"
      ? 20
      : tier === "Silver"
        ? 15
        : tier === "Bronze"
          ? 10
          : tier === "Provisional"
            ? 5
            : 0;
  const progress = Math.min(1, starts / 2);
  return (
    <Card
      style={{
        gap: theme.spacing.md,
        padding: theme.spacing.md,
        overflow: "hidden",
        backgroundColor: "#07111F",
        borderColor: "#24344B",
      }}
    >
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          gap: 10,
        }}
      >
        <View style={{ flex: 1, gap: 4 }}>
          <Badge label={`BEL ${season}`} variant="warning" />
          <Text variant="title" style={{ color: "#FFFFFF" }}>
            Race Upshot Ranking Progress
          </Text>
          <Text variant="bodySmall" style={{ color: "rgba(255,255,255,0.72)" }}>
            Your current season ranking and points progress.
          </Text>
        </View>
        <Badge
          label={tier}
          variant={tier === "No Tier" ? "neutral" : "success"}
        />
      </View>
      <View
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          gap: theme.spacing.sm,
        }}
      >
        <BelMetric label="BEL Status" value={tier} />
        <BelMetric label="Total Points" value={points} />
        <BelMetric
          label="Overall Rank"
          value={firstText(bel?.overallRank) || "—"}
        />
        <BelMetric
          label="Category Rank"
          value={firstText(bel?.categoryRank) || "—"}
        />
      </View>
      <View
        style={{
          gap: 5,
          padding: theme.spacing.sm,
          borderRadius: theme.radius.medium,
          backgroundColor: "rgba(225,18,42,0.14)",
        }}
      >
        <Text variant="caption" style={{ color: "rgba(255,255,255,0.68)" }}>
          BEL REWARD
        </Text>
        <Text
          variant="bodySmall"
          style={{ color: "#FFFFFF", fontWeight: "800" }}
        >
          {discount > 0
            ? `${discount}% auto-apply discount unlocked`
            : "No BEL reward discount unlocked yet"}
        </Text>
      </View>
      <View style={{ gap: 8 }}>
        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            gap: 8,
          }}
        >
          <View style={{ flex: 1 }}>
            <Text
              variant="caption"
              style={{ color: "#FFFFFF", fontWeight: "900" }}
            >
              ELIGIBILITY PROGRESS
            </Text>
            <Text
              variant="bodySmall"
              style={{ color: "rgba(255,255,255,0.7)" }}
            >
              Minimum 2 starts required for final BEL ranking.
            </Text>
          </View>
          <Text
            variant="bodySmall"
            style={{ color: "#FFFFFF", fontWeight: "900" }}
          >
            {starts} / 2 starts
          </Text>
        </View>
        <View
          style={{
            height: 8,
            borderRadius: 999,
            backgroundColor: "rgba(255,255,255,0.13)",
            overflow: "hidden",
          }}
        >
          <View
            style={{
              width: `${progress * 100}%`,
              height: "100%",
              backgroundColor: theme.colors.accent,
            }}
          />
        </View>
        <Text variant="caption" style={{ color: "rgba(255,255,255,0.72)" }}>
          {Number(points) > 0
            ? `${points} season points`
            : "No BEL points yet · Race to enter BEL standings"}
        </Text>
      </View>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Button
            label="View BEL Details"
            size="sm"
            variant="secondary"
            fullWidth
            onPress={() =>
              void Linking.openURL("https://raceupshot.com/elite-league")
            }
          />
        </View>
        <View style={{ flex: 1 }}>
          <Button
            label="Open Rankings"
            size="sm"
            variant="secondary"
            fullWidth
            onPress={() =>
              void Linking.openURL("https://raceupshot.com/athlete-rankings")
            }
          />
        </View>
      </View>
    </Card>
  );
}

function resultStatus(value: unknown): string {
  const status = text(value).toUpperCase();
  if (status.includes("DNF")) return "DNF";
  if (status.includes("DNQ") || status.includes("DSQ")) return "DNQ";
  if (status.includes("DNS") || !status) return "DNS";
  if (status.includes("FINISH") || status.includes("COMPLETE"))
    return "Finished";
  return status;
}

type RaceHistoryResult = NonNullable<AthleteDashboard["recentResults"]>[number];

function hasOfficialRaceData(result: RaceHistoryResult): boolean {
  return [
    result.chipTime,
    result.overallRank,
    result.position,
    result.genderRank,
    result.categoryRank,
    result.swim,
    result.t1,
    result.bike,
    result.t2,
    result.run,
  ].some(
    (value) =>
      value !== null &&
      value !== undefined &&
      text(value) !== "" &&
      text(value).toUpperCase() !== "N/A",
  );
}

function raceHistoryStatus(result: RaceHistoryResult): string {
  const status = resultStatus(result.status);
  const date = toDate(result.date);
  const isPast = Boolean(date && date.getTime() + 24 * 60 * 60 * 1000 <= Date.now());
  if (
    isPast &&
    !hasOfficialRaceData(result) &&
    ["ACTIVE", "REGISTERED", "CONFIRMED", "UPCOMING"].includes(status)
  ) {
    return "DNS";
  }
  return status;
}

function RaceHistoryCard({
  results,
}: {
  results: NonNullable<AthleteDashboard["recentResults"]>;
}) {
  const theme = useTheme();
  const [filter, setFilter] = useState("All");
  const [search, setSearch] = useState("");
  const [selectedResult, setSelectedResult] =
    useState<RaceHistoryResult | null>(null);
  const filters = ["All", "Finished", "DNF", "DNQ", "DNS"];
  const rows = results.filter((result) => {
    const status = raceHistoryStatus(result);
    if (filter !== "All" && status !== filter) return false;
    const query = search.trim().toLowerCase();
    return (
      !query ||
      [result.event, result.contest, result.location, result.bib].some(
        (value) => text(value).toLowerCase().includes(query),
      )
    );
  });
  return (
    <>
      <Card style={{ gap: theme.spacing.md, padding: theme.spacing.md }}>
        <View style={{ gap: 3 }}>
          <Text variant="title">Your Race History</Text>
          <Text variant="bodySmall" color="textMuted">
            A comprehensive log of all your race results.
          </Text>
        </View>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {filters.map((item) => {
            const count =
              item === "All"
                ? results.length
                : results.filter((row) => raceHistoryStatus(row) === item)
                    .length;
            return (
              <View
                key={item}
                style={{ flexGrow: 1, flexBasis: "30%", minWidth: 84 }}
              >
                <Button
                  label={`${item} (${count})`}
                  size="sm"
                  fullWidth
                  variant={filter === item ? "primary" : "secondary"}
                  onPress={() => setFilter(item)}
                />
              </View>
            );
          })}
        </View>
        <SearchBar
          value={search}
          onChangeText={setSearch}
          placeholder="Search races"
          dense
        />
        {rows.length ? (
          rows.map((result, index) => {
            const officialResult =
              hasOfficialRaceData(result) ||
              ["Finished", "DNF", "DNQ"].includes(raceHistoryStatus(result));
            return (
              <Pressable
                key={result.id ?? `${result.event}-${result.bib}-${index}`}
                accessibilityRole={officialResult ? "button" : undefined}
                accessibilityLabel={
                  officialResult ? `Open result for ${result.event}` : undefined
                }
                disabled={!officialResult}
                onPress={() => setSelectedResult(result)}
                style={({ pressed }) => ({
                  gap: 7,
                  paddingVertical: theme.spacing.sm,
                  paddingHorizontal: pressed ? 6 : 0,
                  borderRadius: 10,
                  backgroundColor: pressed
                    ? theme.colors.surfaceSunken
                    : "transparent",
                  borderTopWidth: index ? 1 : 0,
                  borderTopColor: theme.colors.border,
                })}
              >
                <View
                  style={{
                    flexDirection: "row",
                    justifyContent: "space-between",
                    gap: 8,
                  }}
                >
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text variant="headline" numberOfLines={1}>
                      {result.event}
                    </Text>
                    <Text variant="caption" color="textMuted" numberOfLines={2}>
                      {formatDate(result.date)} · {result.contest || "Race"}
                      {result.location ? ` · ${result.location}` : ""}
                    </Text>
                    {result.bib ? (
                      <Text variant="caption" color="textMuted">
                        Bib {result.bib}
                      </Text>
                    ) : null}
                  </View>
                  <Badge
                    label={raceHistoryStatus(result)}
                    variant={
                      raceHistoryStatus(result) === "Finished"
                        ? "success"
                        : "warning"
                    }
                  />
                </View>
                {(() => {
                  const values = [
                    ["Chip", result.chipTime],
                    ["Points", result.pointsEarned],
                    ["Overall", result.overallRank ?? result.position],
                    ["Gender", result.genderRank],
                    ["Category", result.categoryRank],
                    ["Swim", result.swim],
                    ["T1", result.t1],
                    ["Bike", result.bike],
                    ["T2", result.t2],
                    ["Run", result.run],
                  ].filter(
                    ([, value]) =>
                      value !== null &&
                      value !== undefined &&
                      text(value) !== "" &&
                      text(value).toUpperCase() !== "N/A",
                  );
                  return values.length ? (
                    <View
                      style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}
                    >
                      {values.map(([label, value]) => (
                        <View
                          key={String(label)}
                          style={{
                            flexDirection: "row",
                            gap: 4,
                            paddingHorizontal: 8,
                            paddingVertical: 5,
                            borderRadius: 999,
                            backgroundColor: theme.colors.surfaceSunken,
                          }}
                        >
                          <Text variant="caption" color="textMuted">
                            {label}
                          </Text>
                          <Text variant="caption" style={{ fontWeight: "900" }}>
                            {String(value)}
                          </Text>
                        </View>
                      ))}
                    </View>
                  ) : (
                    <Text variant="caption" color="textMuted">
                      Official timing data is not available yet.
                    </Text>
                  );
                })()}
                {officialResult ? (
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 4,
                    }}
                  >
                    <Text
                      variant="caption"
                      color="accent"
                      style={{ fontWeight: "900" }}
                    >
                      View result and splits
                    </Text>
                    <Icon name="chevronRight" color="accent" size={15} />
                  </View>
                ) : null}
              </Pressable>
            );
          })
        ) : (
          <EmptyState
            title="No race results"
            description="No races match this filter."
          />
        )}
        <Text variant="caption" color="textMuted">
          If your timing or race data is incorrect, email info@raceupshot.com
          for verification.
        </Text>
      </Card>
      <Modal
        visible={Boolean(selectedResult)}
        onClose={() => setSelectedResult(null)}
        title={selectedResult?.event || "Official Result"}
      >
        {selectedResult ? (
          <ScrollView contentContainerStyle={{ gap: 12 }}>
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 10,
              }}
            >
              <View style={{ flex: 1, gap: 3 }}>
                <Text variant="headline">
                  {selectedResult.contest || "Race Result"}
                </Text>
                <Text variant="caption" color="textMuted">
                  {formatDate(selectedResult.date)}
                  {selectedResult.bib ? ` · Bib ${selectedResult.bib}` : ""}
                </Text>
              </View>
              <Badge
                label={raceHistoryStatus(selectedResult)}
                variant={
                  raceHistoryStatus(selectedResult) === "Finished"
                    ? "success"
                    : "warning"
                }
              />
            </View>

            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 7 }}>
              {[
                ["Finish Time", selectedResult.chipTime],
                [
                  "Overall",
                  selectedResult.overallRank ?? selectedResult.position,
                ],
                ["Gender", selectedResult.genderRank],
                ["Category", selectedResult.categoryRank],
                ["Points", selectedResult.pointsEarned],
              ]
                .filter(
                  ([, value]) =>
                    value !== null &&
                    value !== undefined &&
                    text(value) !== "" &&
                    text(value).toUpperCase() !== "N/A",
                )
                .map(([label, value]) => (
                  <View
                    key={String(label)}
                    style={{
                      flexGrow: 1,
                      flexBasis: "30%",
                      minWidth: 90,
                      gap: 3,
                      padding: 9,
                      borderRadius: 10,
                      backgroundColor: theme.colors.surfaceSunken,
                    }}
                  >
                    <Text variant="caption" color="textMuted">
                      {label}
                    </Text>
                    <Text variant="headline">{String(value)}</Text>
                  </View>
                ))}
            </View>

            <View style={{ gap: 7 }}>
              <Text variant="headline">Your Splits</Text>
              {[
                ["Swim", selectedResult.swim],
                ["T1", selectedResult.t1],
                ["Bike", selectedResult.bike],
                ["T2", selectedResult.t2],
                ["Run", selectedResult.run],
              ]
                .filter(
                  ([, value]) =>
                    value !== null &&
                    value !== undefined &&
                    text(value) !== "" &&
                    text(value).toUpperCase() !== "N/A",
                )
                .map(([label, value]) => (
                  <View
                    key={String(label)}
                    style={{
                      flexDirection: "row",
                      justifyContent: "space-between",
                      alignItems: "center",
                      paddingVertical: 9,
                      borderBottomWidth: 1,
                      borderBottomColor: theme.colors.border,
                    }}
                  >
                    <Text variant="bodySmall" color="textMuted">
                      {label}
                    </Text>
                    <Text variant="headline">{String(value)}</Text>
                  </View>
                ))}
            </View>
          </ScrollView>
        ) : null}
      </Modal>
    </>
  );
}

function YearlyRankingsCard({
  dashboard,
  athleteName,
  athleteId,
  athleteEmail,
  athleteMobile,
  onBrowseEvents,
}: {
  dashboard?: AthleteDashboard;
  athleteName: string;
  athleteId?: string;
  athleteEmail?: string;
  athleteMobile?: string;
  onBrowseEvents: () => void;
}) {
  const theme = useTheme();
  const currentYear = String(new Date().getFullYear());
  const seasonYear = text(dashboard?.bel?.season) || currentYear;
  const [year, setYear] = useState(seasonYear);
  const [yearPickerOpen, setYearPickerOpen] = useState(false);
  const yearsQuery = useQuery({
    queryKey: queryKeys.rankings.years,
    queryFn: () => repositories.mobile.getAthleteRankingYears(),
    staleTime: 10 * 60_000,
    gcTime: 24 * 60 * 60_000,
    retry: 1,
  });
  const years = useMemo(() => {
    const values = new Set(
      (yearsQuery.data ?? [])
        .map(String)
        .filter((value) => Number(value) >= 2022),
    );
    values.add(seasonYear);
    return [...values].sort((a, b) => Number(b) - Number(a));
  }, [seasonYear, yearsQuery.data]);

  const selectedYear = years.includes(year) ? year : years[0] || year;

  const rankingSearch = firstText(
    athleteEmail,
    athleteMobile,
    athleteId,
    athleteName,
  );
  const rankingQuery = useQuery({
    queryKey: queryKeys.rankings.athletes({
      season: selectedYear,
      search: rankingSearch,
    }),
    queryFn: () =>
      repositories.mobile.getAthleteRankings({
        season: selectedYear,
        search: rankingSearch,
        limit: 100,
      }),
    staleTime: 5 * 60_000,
    enabled: Boolean(selectedYear && rankingSearch),
    retry: 1,
  });
  const normalizeMobile = (value: unknown) => text(value).replace(/\D/g, "");
  const ranking = useMemo(() => {
    const rows = rankingQuery.data?.items ?? [];
    const uid = text(athleteId).toLowerCase();
    const email = text(athleteEmail).toLowerCase();
    const mobile = normalizeMobile(athleteMobile);
    const name = text(athleteName).toLowerCase();
    return (
      rows.find((row) => {
        const rowId = firstText(row.athleteId, row.uid, row.id).toLowerCase();
        const rowEmail = text(row.email).toLowerCase();
        const rowMobile = normalizeMobile(row.mobile);
        return (
          (uid && rowId === uid) ||
          (email && rowEmail === email) ||
          (mobile && rowMobile === mobile) ||
          text(row.name).toLowerCase() === name
        );
      }) ?? null
    );
  }, [
    athleteEmail,
    athleteId,
    athleteMobile,
    athleteName,
    rankingQuery.data?.items,
  ]);
  const races = Number(ranking?.racesFinished ?? ranking?.starts ?? 0) || 0;
  return (
    <Card style={{ gap: theme.spacing.md, padding: theme.spacing.md }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <Icon name="trophy" color="accent" size={24} />
        <View style={{ flex: 1 }}>
          <Text variant="title">Your Yearly Rankings</Text>
          <Text variant="bodySmall" color="textMuted">
            View your performance for selected event types each year.
          </Text>
        </View>
      </View>
      <View style={{ gap: 8 }}>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Select ranking year"
            accessibilityState={{ expanded: yearPickerOpen }}
            onPress={() => setYearPickerOpen((open) => !open)}
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
              minWidth: 104,
              paddingHorizontal: 11,
              paddingVertical: 8,
              borderRadius: 10,
              borderWidth: 1,
              borderColor: yearPickerOpen
                ? theme.colors.accent
                : theme.colors.border,
              backgroundColor: theme.colors.surfaceSunken,
            }}
          >
            <Text variant="bodySmall" style={{ fontWeight: "900" }}>
              {selectedYear}
            </Text>
            <Icon name="chevronDown" color="textMuted" size={16} />
          </Pressable>
          <Badge label="All Event Types" variant="neutral" />
        </View>
        {yearPickerOpen ? (
          <View
            accessibilityRole="menu"
            style={{
              gap: 4,
              padding: 5,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: theme.colors.border,
              backgroundColor: theme.colors.surface,
            }}
          >
            {years.map((option) => (
              <Pressable
                key={option}
                accessibilityRole="menuitem"
                accessibilityState={{ selected: option === selectedYear }}
                onPress={() => {
                  setYear(option);
                  setYearPickerOpen(false);
                }}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  paddingHorizontal: 11,
                  paddingVertical: 9,
                  borderRadius: 8,
                  backgroundColor:
                    option === selectedYear
                      ? `${theme.colors.accent}16`
                      : "transparent",
                }}
              >
                <Text
                  variant="bodySmall"
                  style={{
                    fontWeight: "900",
                    color:
                      option === selectedYear
                        ? theme.colors.accent
                        : theme.colors.textPrimary,
                  }}
                >
                  {option}
                </Text>
                {option === selectedYear ? (
                  <Text
                    variant="bodySmall"
                    style={{ color: theme.colors.accent, fontWeight: "900" }}
                  >
                    ✓
                  </Text>
                ) : null}
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>
      {rankingQuery.isLoading ? (
        <Text variant="bodySmall" color="textMuted">
          Loading {selectedYear} ranking…
        </Text>
      ) : ranking && races > 0 ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          <BelMetric
            dark={false}
            label="Overall Rank"
            value={firstText(ranking.rank) || "—"}
          />
          <BelMetric
            dark={false}
            label="Gender Rank"
            value={firstText(ranking.genderRank) || "—"}
          />
          <BelMetric
            dark={false}
            label="Category Rank"
            value={firstText(ranking.categoryRank) || "—"}
          />
          <BelMetric
            dark={false}
            label="Total Points"
            value={firstText(ranking.totalPoints, ranking.points) || "0"}
          />
          <BelMetric dark={false} label="Races" value={String(races)} />
        </View>
      ) : (
        <EmptyState
          title={`No ranking data available for ${athleteName}`}
          description={`Register for your next Race Upshot event to earn points and enter the ${selectedYear} leaderboard.`}
          actionLabel="Browse Events"
          onAction={onBrowseEvents}
        />
      )}
    </Card>
  );
}

export function AthleteDashboardScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { status, user, logout } = useAuth();
  const isAuthenticated = status === "authenticated" && Boolean(user);
  const dashboardQuery = useAthleteDashboard(isAuthenticated);
  const dashboard = dashboardQuery.data;
  const dashboardError = dashboardQuery.error as ApiError | null;
  const lastSuccessfulDashboardFetchRef = useRef(0);
  const [updatingAccountVisibility, setUpdatingAccountVisibility] =
    useState(false);
  const [accountVisibilityOverride, setAccountVisibilityOverride] =
    useState<TrackingVisibility | null>(null);
  const [accountVisibilityError, setAccountVisibilityError] = useState<
    string | null
  >(null);

  const athlete = dashboard?.athlete;
  const athleteName =
    firstText(
      athlete?.name,
      athlete?.fullName,
      user?.displayName,
      user?.email,
    ) || "Athlete";
  const athleteEmail =
    firstText(athlete?.email, user?.email) || "No email available";
  const athleteMobile = firstText(
    recordText(athlete, ["mobile", "phone", "contactNumber"]),
  );
  const athleteCountry = firstText(
    athlete?.country,
    recordText(athlete, ["countryName", "nationality", "countryCode"]),
  );
  const athleteState = firstText(
    athlete?.state,
    recordText(athlete, ["stateName"]),
  );
  const athleteCity = firstText(athlete?.city);
  const athletePhoto = firstText(
    athlete?.photoUrl,
    athlete?.profilePhotoUrl,
    athlete?.photoURL,
    athlete?.profileUrl,
    athlete?.profileURL,
  );
  const backendAccountVisibility = visibilityLabel(
    firstText(
      athlete?.trackingVisibility,
      athlete?.liveTrackingPrivacy,
      athlete?.liveTrackingVisibility,
      athlete?.visibility,
    ),
  );
  const accountVisibility =
    accountVisibilityOverride ?? backendAccountVisibility;
  const location = [
    athleteCountry ? `${countryFlag(athleteCountry)} ${athleteCountry}` : "",
    athleteState || athleteCity,
  ]
    .filter(Boolean)
    .join(", ");

  const registrations = useMemo(() => {
    const rows = [
      ...(dashboard?.registrations ?? []),
      ...(dashboard?.summary?.upcomingRace
        ? [dashboard.summary.upcomingRace]
        : []),
    ].map((item) =>
      normalizeRegistration(
        item as AthleteDashboardRegistration | Record<string, unknown>,
      ),
    );

    const seen = new Set<string>();
    return rows.filter((item) => {
      const key = registrationKey(item);
      if (!key || seen.has(key)) return false;
      if (!isUpcomingRegistration(item)) return false;
      seen.add(key);
      return true;
    });
  }, [dashboard]);

  useEffect(() => {
    if (dashboardQuery.dataUpdatedAt > 0) {
      lastSuccessfulDashboardFetchRef.current = dashboardQuery.dataUpdatedAt;
    }
  }, [dashboardQuery.dataUpdatedAt]);

  const refetchDashboard = dashboardQuery.refetch;
  const refreshDashboard = useCallback(
    (force = false) => {
      const dashboardState = queryClient.getQueryState(
        queryKeys.athleteDashboard(),
      );
      if (dashboardState?.fetchStatus === "fetching") return;
      const lastSuccessfulFetch =
        dashboardState?.dataUpdatedAt ||
        lastSuccessfulDashboardFetchRef.current;
      const elapsed = Date.now() - lastSuccessfulFetch;
      if (!force && lastSuccessfulFetch > 0 && elapsed < 60_000) {
        if (__DEV__)
          console.log("[dashboard] refresh-skipped-fresh", { elapsed });
        return;
      }
      void refetchDashboard();
    },
    [refetchDashboard],
  );

  useEffect(() => {
    if (!isAuthenticated) return undefined;
    const sub = AppState.addEventListener("change", (state: AppStateStatus) => {
      if (state === "active") refreshDashboard(false);
    });
    return () => sub.remove();
  }, [isAuthenticated, refreshDashboard]);

  const applyDashboardVisibility = useCallback(
    (visibility: TrackingVisibility) => {
      const patchRegistration = (registration: AthleteDashboardRegistration) =>
        ({
          ...registration,
          trackingVisibility: visibility,
          liveTrackingPrivacy: visibility,
          liveTrackingVisibility: visibility,
        }) as AthleteDashboardRegistration;

      queryClient.setQueryData<AthleteDashboard>(
        queryKeys.athleteDashboard(),
        (previous) => {
          if (!previous) return previous;
          return {
            ...previous,
            athlete: {
              ...previous.athlete,
              trackingVisibility: visibility,
              liveTrackingPrivacy: visibility,
              liveTrackingVisibility: visibility,
              visibility,
            },
            registrations: previous.registrations?.map(patchRegistration),
            upcomingEvents: previous.upcomingEvents?.map(patchRegistration),
            summary: previous.summary?.upcomingRace
              ? {
                  ...previous.summary,
                  upcomingRace: patchRegistration(
                    previous.summary.upcomingRace,
                  ),
                }
              : previous.summary,
          };
        },
      );

      queryClient.setQueryData(
        user?.uid ? queryKeys.profile(user.uid) : queryKeys.athleteProfile(),
        (previous: unknown) => {
          if (!previous || typeof previous !== "object") return previous;
          return {
            ...(previous as Record<string, unknown>),
            trackingVisibility: visibility,
            liveTrackingPrivacy: visibility,
            liveTrackingVisibility: visibility,
          };
        },
      );
    },
    [user],
  );

  async function updateAccountVisibility(visibility: TrackingVisibility) {
    const previous = accountVisibility;
    setAccountVisibilityOverride(visibility);
    setAccountVisibilityError(null);
    setUpdatingAccountVisibility(true);
    try {
      const profile =
        await repositories.profile.updateTrackingPrivacy(visibility);
      const updatedVisibility = visibilityLabel(
        profile.trackingVisibility ?? profile.liveTrackingPrivacy ?? visibility,
      );
      applyDashboardVisibility(updatedVisibility);
      setAccountVisibilityOverride(updatedVisibility);
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: queryKeys.athleteDashboard(),
          refetchType: "active",
        }),
        queryClient.invalidateQueries({
          queryKey: user?.uid
            ? queryKeys.profile(user.uid)
            : queryKeys.athleteProfile(),
          refetchType: "active",
        }),
      ]);
    } catch (error) {
      setAccountVisibilityOverride(previous);
      setAccountVisibilityError(
        error instanceof Error
          ? error.message
          : "Unable to update live tracking visibility.",
      );
    } finally {
      setUpdatingAccountVisibility(false);
    }
  }

  if (status === "loading") {
    return (
      <DashboardShell>
        <ScrollView
          contentContainerStyle={{
            flexGrow: 1,
            justifyContent: "center",
            padding: theme.spacing.base,
          }}
        >
          <LoadingStack />
        </ScrollView>
      </DashboardShell>
    );
  }

  if (status === "guest") {
    return (
      <DashboardShell>
        <ScrollView
          contentContainerStyle={{
            flexGrow: 1,
            justifyContent: "center",
            padding: theme.spacing.base,
          }}
        >
          <Card
            style={{
              alignItems: "center",
              gap: theme.spacing.lg,
              paddingVertical: theme.spacing.xl,
            }}
          >
            <View
              style={{
                width: 88,
                height: 88,
                borderRadius: 44,
                overflow: "hidden",
                borderWidth: 1,
                borderColor: theme.colors.border,
                backgroundColor: theme.colors.surface,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Image
                source={LOGIN_MARK}
                alt="Race Upshot"
                style={{ width: 88, height: 88 }}
                contentFit="cover"
              />
            </View>
            <Text variant="title" center>
              Login to your athlete profile
            </Text>
            <Text variant="bodySmall" color="textMuted" center>
              Manage your registrations and live tracking privacy.
            </Text>
            <Button
              label="Log in as athlete"
              onPress={() => router.push("/auth/login")}
              fullWidth
            />
          </Card>
        </ScrollView>
      </DashboardShell>
    );
  }

  if (dashboardQuery.isLoading && !dashboard) {
    return (
      <DashboardShell>
        <ScrollView
          contentContainerStyle={{
            flexGrow: 1,
            justifyContent: "center",
            padding: theme.spacing.base,
          }}
        >
          <LoadingStack />
        </ScrollView>
      </DashboardShell>
    );
  }

  if (
    dashboardQuery.isError &&
    !dashboard &&
    (dashboardError?.isAuthError ||
      dashboardError?.status === 401 ||
      dashboardError?.status === 403)
  ) {
    const isAuthError =
      dashboardError?.isAuthError ||
      dashboardError?.status === 401 ||
      dashboardError?.status === 403;
    return (
      <DashboardShell>
        <ScrollView
          contentContainerStyle={{
            flexGrow: 1,
            justifyContent: "center",
            padding: theme.spacing.base,
          }}
        >
          <Card style={{ gap: theme.spacing.md }}>
            <EmptyState
              title={
                isAuthError ? "Login required" : "Account data unavailable"
              }
              description={
                isAuthError
                  ? "Please log in again to load your athlete dashboard."
                  : "The mobile API could not load your athlete dashboard."
              }
              actionLabel={isAuthError ? "Log in again" : "Retry"}
              onAction={() => {
                if (isAuthError) {
                  void logout().finally(() => router.replace("/auth/login"));
                  return;
                }
                refreshDashboard(true);
              }}
            />
            {!isAuthError ? (
              <Button
                label="Log in again"
                variant="secondary"
                fullWidth
                onPress={() =>
                  void logout().finally(() => router.replace("/auth/login"))
                }
              />
            ) : null}
          </Card>
        </ScrollView>
      </DashboardShell>
    );
  }

  const hasDashboardError = dashboardQuery.isError && !dashboard;

  return (
    <DashboardShell>
      <ScrollView
        contentContainerStyle={{
          padding: theme.spacing.base,
          paddingBottom: 52,
          gap: theme.spacing.lg,
        }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={dashboardQuery.isRefetching}
            onRefresh={() => {
              refreshDashboard(true);
            }}
            tintColor={theme.colors.accent}
          />
        }
      >
        {hasDashboardError ? (
          <Animated.View entering={FadeInDown.duration(180)}>
            <Card
              style={{
                gap: theme.spacing.md,
                borderColor: theme.colors.warning,
              }}
            >
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: theme.spacing.sm,
                }}
              >
                <View
                  style={{
                    width: 42,
                    height: 42,
                    borderRadius: theme.radius.medium,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: `${theme.colors.warning}18`,
                  }}
                >
                  <Icon name="bell" color="warning" size={20} />
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text variant="headline">Account data unavailable</Text>
                  <Text variant="bodySmall" color="textMuted">
                    You are signed in, but the mobile API could not load
                    dashboard data.
                  </Text>
                </View>
              </View>
              <Text variant="bodySmall" color="textSecondary">
                Showing your signed-in profile while the backend recovers.
                Profile and registrations will appear after the Race Upshot account API
                composes the profile, user, and events index KV rows.
              </Text>
              <Button
                label="Retry dashboard"
                size="sm"
                variant="secondary"
                loading={dashboardQuery.isRefetching}
                onPress={() => {
                  refreshDashboard(true);
                }}
              />
            </Card>
          </Animated.View>
        ) : null}

        <Animated.View entering={FadeInDown.duration(220)}>
          <Card
            style={{
              gap: theme.spacing.lg,
              overflow: "hidden",
              borderRadius: theme.radius.large,
              backgroundColor: theme.colors.textPrimary,
              borderColor: theme.colors.textPrimary,
            }}
          >
            <View
              style={{
                position: "absolute",
                top: -56,
                right: -42,
                width: 180,
                height: 180,
                borderRadius: 90,
                backgroundColor: `${theme.colors.accent}55`,
              }}
            />
            <View
              style={{
                position: "absolute",
                bottom: -76,
                left: -48,
                width: 190,
                height: 190,
                borderRadius: 95,
                backgroundColor: `${theme.colors.accentSecondary}40`,
              }}
            />
            <View
              style={{
                flexDirection: "row",
                gap: theme.spacing.md,
                alignItems: "center",
              }}
            >
              <Avatar
                name={athleteName}
                uri={athletePhoto || undefined}
                size={88}
                bordered
              />
              <View style={{ flex: 1, gap: 8 }}>
                <Text
                  variant="title"
                  style={{ color: theme.colors.textInverse }}
                  numberOfLines={2}
                >
                  {countryFlag(athleteCountry)} {athleteName}
                </Text>
                <Text
                  variant="bodySmall"
                  style={{ color: "rgba(255,255,255,0.74)" }}
                  numberOfLines={1}
                >
                  {athleteEmail}
                </Text>
                {athleteMobile ? (
                  <Text
                    variant="bodySmall"
                    style={{ color: "rgba(255,255,255,0.74)" }}
                    numberOfLines={1}
                  >
                    {athleteMobile}
                  </Text>
                ) : null}
              </View>
            </View>

            <View
              style={{
                flexDirection: "row",
                flexWrap: "wrap",
                gap: theme.spacing.sm,
              }}
            >
              <InfoPill label="Country" value={location || "Not set"} />
            </View>
          </Card>
        </Animated.View>

        <MobileAnnouncementStrip screen="account" />

        <Animated.View
          entering={FadeInDown.duration(260)}
          style={{ gap: theme.spacing.sm }}
        >
          <SectionHeader title="Your Upcoming Registrations" />
          <Text variant="bodySmall" color="textMuted">
            Manage your active registrations for upcoming events. Past races can
            be found in Race History and My Orders.
          </Text>
          {registrations.length > 0 ? (
            <View style={{ gap: theme.spacing.sm }}>
              {registrations.map((item) => {
                const key = registrationKey(item);
                const eventId = safeRouteEventId(item.eventId, item.id);
                return (
                  <RegistrationTableRow
                    key={key}
                    item={item}
                    onOpenEvent={() => {
                      if (eventId) router.push(`/event/${eventId}`);
                    }}
                    onTrack={() => {
                      if (eventId) {
                        router.push({
                          pathname: "/event/[eventId]/track",
                          params: trackRouteParams(item, eventId, user?.uid),
                        });
                      }
                    }}
                  />
                );
              })}
            </View>
          ) : (
            <Card>
              <EmptyState
                title="No upcoming registrations"
                description="Your active registrations will appear here after the Race Upshot account API returns your events."
                actionLabel="Browse Events"
                onAction={() => router.push("/events")}
              />
            </Card>
          )}
        </Animated.View>

        <Animated.View
          entering={FadeInDown.duration(270)}
          style={{ gap: theme.spacing.sm }}
        >
          <SectionHeader title="Live Tracking Visibility" />
          <AccountPrivacyCard
            visibility={accountVisibility}
            updating={updatingAccountVisibility}
            error={accountVisibilityError}
            onChange={(visibility) => void updateAccountVisibility(visibility)}
          />
        </Animated.View>

        {SHOW_RANKING_SECTIONS ? (
          <>
            <Animated.View entering={FadeInDown.duration(280)}>
              <BelProgressCard dashboard={dashboard} />
            </Animated.View>

            <Animated.View entering={FadeInDown.duration(290)}>
              <YearlyRankingsCard
                dashboard={dashboard}
                athleteName={athleteName}
                athleteId={firstText(athlete?.uid, athlete?.id, user?.uid)}
                athleteEmail={athleteEmail}
                athleteMobile={athleteMobile}
                onBrowseEvents={() => router.push("/events")}
              />
            </Animated.View>
          </>
        ) : null}

        <Animated.View entering={FadeInDown.duration(300)}>
          <RaceHistoryCard results={dashboard?.recentResults ?? []} />
        </Animated.View>

        <Card style={{ gap: theme.spacing.sm }}>
          <Text variant="headline">Account</Text>
          <Text variant="bodySmall" color="textMuted">
            Sign out of this device when you are done.
          </Text>
          <Button
            label="Log out"
            variant="destructive"
            fullWidth
            onPress={() => {
              void logout().finally(() => router.replace("/auth/login"));
            }}
          />
        </Card>
      </ScrollView>
    </DashboardShell>
  );
}
