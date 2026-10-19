import { View } from "react-native";
import { Image } from "expo-image";

import { useTheme } from "@/core/theme";
import { Badge, Card, Text } from "@/shared/components";
import type { AthleteDetailViewModel, AthleteHeaderView, MetricRow } from "@/features/tracking/mappers";

type Props = {
  detail: AthleteDetailViewModel;
  header: AthleteHeaderView;
  eventName?: string;
  eventLogoUrl?: string;
  participantCount?: number;
};

function rankValue(rows: MetricRow[], label: string): MetricRow | undefined {
  return rows.find((row) => row.label.toLowerCase() === label.toLowerCase());
}

function RankTile({ label, rank, fallbackTotal }: { label: string; rank?: MetricRow; fallbackTotal?: number }) {
  const value = rank?.value;
  const total = rank?.total ?? fallbackTotal;
  return <View style={{ flex: 1, minWidth: 86, gap: 4, padding: 10, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.08)" }}>
    <Text variant="caption" style={{ color: "#AEB6C3", fontWeight: "900", fontSize: 10 }}>{label}</Text>
    <Text variant="headline" style={{ color: "#FFFFFF", fontWeight: "900" }}>
      {value ? total && total > 0 && /^\d+$/.test(value) ? `${value} / ${total}` : value : "Pending"}
    </Text>
  </View>;
}

function ordinal(value?: string): string {
  const rank = Number(value);
  if (!Number.isFinite(rank) || rank <= 0) return "Pending";
  const lastTwo = rank % 100;
  const suffix = lastTwo >= 11 && lastTwo <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" }[rank % 10] ?? "th");
  return `${rank}${suffix}`;
}

function displayDuration(value?: string): string {
  const match = String(value ?? "").trim().match(/^(\d{1,3}):(\d{2}):(\d{2})(?:\.\d+)?$/);
  return match ? `${match[1].padStart(2, "0")}:${match[2]}:${match[3]}` : value || "Pending";
}

function ResultSplitRow({
  label, distance, pace, time,
}: { label: string; distance?: number; pace?: string; time?: string }) {
  return <View style={{ gap: 5, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.075)" }}>
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      <Text variant="bodySmall" style={{ flex: 1, color: "#FFFFFF", fontWeight: "900" }}>{label}</Text>
      <Text variant="caption" style={{ width: 62, color: "#B8C0CE", textAlign: "right" }}>{distance != null ? `${distance} km` : "—"}</Text>
      <Text variant="caption" style={{ width: 72, color: "#B8C0CE", textAlign: "right" }}>{pace || "—"}</Text>
      <Text variant="bodySmall" style={{ width: 74, color: "#FFFFFF", fontWeight: "900", textAlign: "right" }}>{time || "—"}</Text>
    </View>
  </View>;
}

/** Event-scoped, share-ready finisher result layout. It intentionally owns no upload state. */
export function FinisherRankCard({ detail, header, eventName, eventLogoUrl, participantCount }: Props) {
  const theme = useTheme();
  const eventTitle = eventName || header.eventName || header.contest || "Race Upshot Event";
  const ranks = detail.result?.ranks?.length ? detail.result.ranks : detail.rankings;
  const overall = rankValue(ranks, "Overall");
  const gender = rankValue(ranks, "Gender");
  const ageGroup = rankValue(ranks, "Category") || rankValue(ranks, "Age Group");
  const officialTime = displayDuration(detail.result?.officialTime || detail.result?.chipTime || detail.result?.gunTime) || (detail.raceTiming?.overallTimeSeconds != null
    ? new Date(detail.raceTiming.overallTimeSeconds * 1000).toISOString().slice(11, 19)
    : "Pending");
  const provisional = detail.result?.provisional !== false;
  const splits = detail.result?.splits ?? [];

  return <Card
    elevated={false}
    style={{
      gap: theme.spacing.md,
      overflow: "hidden",
      backgroundColor: "#08142B",
      borderColor: "#EFCB00",
      borderWidth: 1.5,
    }}
  >
    <View style={{ position: "absolute", top: -44, right: -34, width: 154, height: 154, borderRadius: 77, backgroundColor: "rgba(255,255,255,0.05)" }} />
    <View style={{ alignItems: "center", gap: 7 }}>
      {eventLogoUrl ? (
        <Image
          source={{ uri: eventLogoUrl }}
          contentFit="contain"
          accessibilityLabel={`${eventTitle} logo`}
          style={{ width: 156, height: 64 }}
        />
      ) : (
        <Text variant="caption" style={{ color: "#EFCB00", fontWeight: "900", letterSpacing: 1.2 }}>
          {eventTitle.toUpperCase()}
        </Text>
      )}
      <Text variant="caption" style={{ color: "#AEB6C3", fontWeight: "900", letterSpacing: 1.1 }}>FINISHER RESULT</Text>
      <Text variant="headline" style={{ color: "#FFFFFF", fontWeight: "900", textAlign: "center" }} numberOfLines={2}>{eventTitle}</Text>
      <Badge label={provisional ? "Provisional Results" : "Official Result"} variant={provisional ? "upcoming" : "finished"} />
    </View>
    <View style={{ gap: 3, alignItems: "center" }}>
      <Text variant="title" style={{ color: "#FFFFFF", fontWeight: "900", textAlign: "center" }}>{header.name}</Text>
      <Text variant="bodySmall" style={{ color: "#C7CDD6", textAlign: "center" }}>BIB {header.bib || "—"}{header.contest ? ` · ${header.contest}` : ""}</Text>
    </View>
    <View style={{ alignItems: "center", gap: 5, paddingVertical: 20, borderRadius: 18, borderWidth: 2, borderColor: "#EFCB00" }}>
      <Text variant="caption" style={{ color: "#EFCB00", fontWeight: "900", letterSpacing: 2 }}>FINISH TIME</Text>
      <Text variant="display" style={{ color: "#FFFFFF", fontWeight: "900" }}>{officialTime}</Text>
    </View>
    {(detail.result?.distanceKm != null || detail.result?.averageSpeedKmh != null) ? <View style={{ flexDirection: "row", gap: 8 }}>
      {detail.result?.distanceKm != null ? <RankTile label="DISTANCE" rank={{ label: "Distance", value: `${detail.result.distanceKm.toFixed(2)} km` }} /> : null}
      {detail.result?.averageSpeedKmh != null ? <RankTile label="AVG SPEED" rank={{ label: "Average speed", value: `${detail.result.averageSpeedKmh.toFixed(2)} km/h` }} /> : null}
    </View> : null}
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      <RankTile label="OVERALL" rank={overall ? { ...overall, value: ordinal(overall.value) } : undefined} fallbackTotal={participantCount} />
      <RankTile label="GENDER" rank={gender ? { ...gender, value: ordinal(gender.value) } : undefined} />
      <RankTile label={header.category ? `AGE GROUP ${header.category}` : "AGE GROUP"} rank={ageGroup ? { ...ageGroup, value: ordinal(ageGroup.value) } : undefined} />
    </View>
    {splits.length > 0 ? <View style={{ gap: 8 }}>
      <Text variant="label" style={{ color: "#EFCB00", fontWeight: "900", letterSpacing: 1.5, textAlign: "center" }}>RACE SPLITS</Text>
      <View style={{ flexDirection: "row", paddingHorizontal: 12 }}>
        <Text variant="caption" style={{ flex: 1, color: "#AEB6C3", fontWeight: "900" }}>SEGMENT</Text>
        <Text variant="caption" style={{ width: 72, color: "#AEB6C3", fontWeight: "900", textAlign: "right" }}>PACE</Text>
        <Text variant="caption" style={{ width: 74, color: "#AEB6C3", fontWeight: "900", textAlign: "right" }}>TIME</Text>
      </View>
      {splits.map((split, index) => <ResultSplitRow key={`${split.label}-${index}`} label={split.label} distance={split.distanceKm} pace={split.paceSpeed} time={displayDuration(split.value || split.segmentTime)} />)}
    </View> : null}
    <Text variant="caption" style={{ color: "#AEB6C3", textAlign: "center" }}>
      {provisional ? "PROVISIONAL RESULT\nTimes and rankings may be updated after official verification." : "OFFICIAL RESULT"}
    </Text>
  </Card>;
}
