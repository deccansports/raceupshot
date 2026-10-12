import {
  Image,
  Linking,
  Platform,
  Share,
  StyleSheet,
  View,
} from "react-native";
import { finisherMessageFor } from "@bergman/live-tracking-contracts";

import { useTheme } from "@/core/theme";
import { Button, Text } from "@/shared/components";
import type {
  AthleteHeaderView,
  AthleteResultView,
  MetricRow,
} from "@/features/tracking/mappers";

const BERGMAN_MALE_LOGO = require("../../../../../../assets/images/Bmlogowhite.png");
const BERGMAN_FEMALE_LOGO = require("../../../../../../assets/images/Bwwhitelogo.png");

const PANEL_BG = "#101A33";
const PANEL_BG_ELEVATED = "#1B2744";
const PANEL_BG_SOFT = "#212E4A";
const PANEL_BORDER = "rgba(255, 214, 10, 0.22)";
const PANEL_TEXT = "#FFFFFF";
const PANEL_MUTED = "rgba(255,255,255,0.74)";
const PANEL_FAINT = "rgba(255,255,255,0.5)";
const PANEL_ACCENT = "#FFD60A";

function ordinal(value: string): string {
  const rank = Number.parseInt(value, 10);
  if (!Number.isFinite(rank)) return value;

  const suffix =
    rank % 100 >= 11 && rank % 100 <= 13
      ? "th"
      : rank % 10 === 1
        ? "st"
        : rank % 10 === 2
          ? "nd"
          : rank % 10 === 3
            ? "rd"
            : "th";

  return `${rank}${suffix}`;
}

function metaValue(rows: MetricRow[], label: string): string | undefined {
  return rows.find((row) => row.label.toLowerCase() === label.toLowerCase())
    ?.value;
}

function buildCertificateUrl(
  eventSlug: string | undefined,
  bib: string,
): string | undefined {
  const slug = String(eventSlug ?? "")
    .trim()
    .replace(/^\/+|\/+$/g, "");
  const bibNumber = String(bib ?? "")
    .trim()
    .replace(/^\/+|\/+$/g, "");
  if (!slug || !bibNumber) return undefined;
  return `https://bergmantri.com/certificate/${encodeURIComponent(slug)}/${encodeURIComponent(bibNumber)}`;
}

function RankCard({ rank }: { rank: MetricRow }) {
  return (
    <View style={styles.rankCard}>
      <Text variant="bodySmall" style={styles.rankLabel}>
        {rank.label}
      </Text>
      <Text variant="display" style={styles.rankValue}>
        {ordinal(rank.value)}
      </Text>
    </View>
  );
}

function SplitRow({
  split,
  index,
}: {
  split: AthleteResultView["splits"][number];
  index: number;
}) {
  return (
    <View style={[styles.splitRow, index > 0 && styles.splitBorder]}>
      <View style={styles.splitIdentity}>
        <Text variant="body" style={styles.splitPoint}>
          {split.label}
        </Text>
        {split.distanceKm != null ? (
          <Text variant="caption" style={styles.splitMeta}>
            {split.distanceKm.toFixed(2)} km total
          </Text>
        ) : null}
      </View>
      <View style={styles.splitMetrics}>
        <View style={styles.splitMetric}>
          <Text variant="caption" style={styles.splitMeta}>
            TIME
          </Text>
          <Text variant="monoMetric" style={styles.splitValue}>
            {split.value}
          </Text>
        </View>
        <View style={styles.splitMetric}>
          <Text variant="caption" style={styles.splitMeta}>
            TIME OF DAY
          </Text>
          <Text variant="monoMetric" style={styles.splitValue}>
            {split.timeOfDay || "—"}
          </Text>
        </View>
        <View style={styles.splitMetric}>
          <Text variant="caption" style={styles.splitMeta}>
            SEGMENT
          </Text>
          <Text variant="monoMetric" style={styles.splitValue}>
            {split.segmentTime || "—"}
          </Text>
        </View>
        <View style={styles.splitMetric}>
          <Text variant="caption" style={styles.splitMeta}>
            PACE / SPEED
          </Text>
          <Text variant="monoMetric" style={styles.splitValue}>
            {split.paceSpeed || "—"}
          </Text>
        </View>
        <View style={styles.splitMetric}>
          <Text variant="caption" style={styles.splitMeta}>
            RANK
          </Text>
          <Text variant="monoMetric" style={styles.splitValue}>
            {split.rank ? `#${split.rank}` : "—"}
          </Text>
        </View>
      </View>
    </View>
  );
}

export function OfficialResultsCard({
  header,
  result,
  eventSlug,
  eventName,
}: {
  header: AthleteHeaderView;
  result: AthleteResultView;
  eventSlug?: string;
  eventName?: string;
}) {
  const theme = useTheme();
  const contestTitle =
    header.contest || metaValue(result.meta, "Event") || "Race";
  const eventTitle =
    String(eventName ?? "").trim() ||
    header.eventName ||
    metaValue(result.meta, "Event Name") ||
    contestTitle;
  const showContestTitle =
    contestTitle.localeCompare(eventTitle, undefined, {
      sensitivity: "base",
    }) !== 0;
  const ageGroup = metaValue(result.meta, "Category") || header.category;
  const raceDate = metaValue(result.meta, "Race Date") || header.eventDate;
  const gender = String(header.gender ?? "")
    .trim()
    .toLowerCase();
  const logoSource =
    gender === "female" ||
    gender === "f" ||
    gender === "women" ||
    gender === "woman"
      ? BERGMAN_FEMALE_LOGO
      : BERGMAN_MALE_LOGO;
  const statusLabel = result.statusLabel.toUpperCase();
  const statusCode = statusLabel.startsWith("DNF") ? "DNF" : statusLabel;
  const officialTime = result.officialTime || result.chipTime || result.gunTime;
  const certificateUrl = buildCertificateUrl(eventSlug, header.bib);
  const splitGroups = result.splits.reduce<
    { leg: string; rows: AthleteResultView["splits"] }[]
  >((groups, split) => {
    const leg = String(split.leg || "Race")
      .replace(/_/g, " ")
      .toUpperCase();
    const existing = groups.find((group) => group.leg === leg);
    if (existing) existing.rows.push(split);
    else groups.push({ leg, rows: [split] });
    return groups;
  }, []);
  const outcomeVerb =
    statusCode === "DNF"
      ? "did not finish"
      : statusCode === "DNS"
        ? "did not start"
        : statusCode === "DNQ"
          ? "did not qualify"
          : statusCode === "DSQ"
            ? "was disqualified from"
            : "successfully completed";
  const heroSentence =
    statusCode === "FINISHED"
      ? `${header.name} finished ${contestTitle}${officialTime ? ` in ${officialTime}` : ""}.`
      : [
          header.name,
          outcomeVerb,
          contestTitle,
          raceDate ? `on ${raceDate}` : "",
          ".",
        ]
          .join(" ")
          .replace(/\s+\./g, ".")
          .replace(/\s+/g, " ")
          .trim();
  const finisherMessage = finisherMessageFor(
    `${header.athleteUid || header.bib}:${eventTitle}`,
  );

  return (
    <View
      style={[
        styles.panel,
        {
          borderRadius: theme.radius.xl,
          ...(Platform.OS === "web"
            ? ({ boxShadow: "0 18px 34px rgba(0,0,0,0.24)" } as any)
            : {
                shadowColor: "#000",
                shadowOpacity: 0.24,
                shadowRadius: 22,
                shadowOffset: { width: 0, height: 12 },
              }),
        },
      ]}
    >
      <View style={styles.heroHeader}>
        <Image
          source={logoSource}
          style={styles.logo}
          resizeMode="contain"
          alt="Bergman logo"
        />
        <View style={styles.nameWrap}>
          <View style={styles.flagNameRow}>
            {header.countryFlag ? (
              <Text variant="display" style={styles.flagText}>
                {header.countryFlag}
              </Text>
            ) : null}
            <Text
              variant="display"
              style={[styles.panelText, styles.nameText]}
              numberOfLines={2}
            >
              {header.name}
            </Text>
          </View>
          <Text
            variant="headline"
            style={[
              styles.statusText,
              statusCode === "FINISHED"
                ? styles.statusFinished
                : statusCode === "DNF"
                  ? styles.statusDnf
                  : styles.statusDns,
            ]}
          >
            {statusLabel}
          </Text>
          <Text variant="title" style={styles.eventTitle}>
            {eventTitle}
          </Text>
          {showContestTitle ? (
            <Text variant="headline" style={styles.categoryText}>
              {contestTitle}
            </Text>
          ) : null}
          <Text variant="body" style={styles.raceCategoryText}>
            {[ageGroup, header.bib ? `Bib ${header.bib}` : ""]
              .filter(Boolean)
              .join(" · ")}
          </Text>
        </View>
      </View>

      <Text variant="body" style={styles.descriptionText}>
        {heroSentence}
      </Text>

      {statusCode === "FINISHED" ? (
        <View style={styles.congratulationsCard}>
          <Text variant="headline" style={styles.congratulationsTitle}>
            Congratulations, {header.name}!
          </Text>
          <Text variant="body" style={styles.congratulationsMessage}>
            {finisherMessage}
          </Text>
        </View>
      ) : null}

      {officialTime ? (
        <View style={styles.finishTimeCard}>
          <Text variant="label" style={styles.finishTimeLabel}>
            {statusCode === "FINISHED" ? "FINISH TIME" : "OFFICIAL TIME"}
          </Text>
          <Text variant="display" style={styles.finishTimeValue}>
            {officialTime}
          </Text>
          {statusCode === "FINISHED" ? (
            <View style={styles.officialDetailRow}>
              {result.chipTime ? (
                <View style={styles.officialDetail}>
                  <Text variant="caption" style={styles.detailLabel}>
                    CHIP TIME
                  </Text>
                  <Text variant="monoMetric" style={styles.detailText}>
                    {result.chipTime}
                  </Text>
                </View>
              ) : null}
              {result.gunTime ? (
                <View style={styles.officialDetail}>
                  <Text variant="caption" style={styles.detailLabel}>
                    GUN TIME
                  </Text>
                  <Text variant="monoMetric" style={styles.detailText}>
                    {result.gunTime}
                  </Text>
                </View>
              ) : null}
              {result.finishTimeOfDay ? (
                <View style={styles.officialDetail}>
                  <Text variant="caption" style={styles.detailLabel}>
                    FINISHED AT
                  </Text>
                  <Text variant="monoMetric" style={styles.detailText}>
                    {result.finishTimeOfDay}
                  </Text>
                  <Text variant="caption" style={styles.detailLabel}>
                    TIME OF DAY
                  </Text>
                </View>
              ) : null}
              {result.averagePace ? (
                <View style={styles.officialDetail}>
                  <Text variant="caption" style={styles.detailLabel}>
                    OVERALL PACE
                  </Text>
                  <Text variant="monoMetric" style={styles.detailText}>
                    {result.averagePace}
                  </Text>
                  <Text variant="caption" style={styles.detailLabel}>
                    FINAL
                  </Text>
                </View>
              ) : null}
            </View>
          ) : null}
        </View>
      ) : statusCode !== "FINISHED" ? (
        <View style={styles.finishTimeCard}>
          <Text variant="label" style={styles.finishTimeLabel}>
            OFFICIAL STATUS
          </Text>
          <Text variant="display" style={styles.finishTimeValue}>
            {statusLabel}
          </Text>
        </View>
      ) : null}

      {result.ranks.length > 0 ? (
        <View style={styles.rankGrid}>
          {result.ranks.map((rank) => (
            <RankCard key={rank.label} rank={rank} />
          ))}
        </View>
      ) : null}

      {statusCode === "FINISHED" ? (
        <View style={styles.completeProgress}>
          <Text variant="label" style={styles.finishTimeLabel}>
            RACE COMPLETE
          </Text>
          <Text variant="display" style={styles.panelText}>
            {Math.round(result.progressPercent ?? 100)}%
          </Text>
          <View style={styles.progressTrack}>
            <View style={styles.progressFill} />
          </View>
        </View>
      ) : null}

      {statusCode === "FINISHED" && (result.sections?.length ?? 0) > 0 ? (
        <View style={styles.section}>
          <Text variant="title" style={styles.sectionTitle}>
            Race Summary
          </Text>
          <View style={styles.sectionSummaryGrid}>
            {result.sections?.map((section) => (
              <View key={section.key} style={styles.sectionSummaryCard}>
                <Text variant="label" style={styles.splitMeta}>
                  {section.label}
                </Text>
                <Text variant="monoMetric" style={styles.panelText}>
                  {section.duration}
                </Text>
                {section.metric ? (
                  <Text variant="caption" style={styles.detailText}>
                    {section.metric}
                  </Text>
                ) : null}
              </View>
            ))}
          </View>
        </View>
      ) : null}

      {result.splits.length > 0 ? (
        <View style={styles.section}>
          <Text variant="title" style={styles.sectionTitle}>
            Your Splits
          </Text>
          <View style={styles.splitTable}>
            <View style={styles.splitHeader}>
              <Text variant="label" style={styles.splitHeaderText}>
                POINT · TIME · TIME OF DAY · SEGMENT · PACE / SPEED · RANK
              </Text>
            </View>
            {splitGroups.map((group) => (
              <View key={group.leg}>
                <View style={styles.legHeader}>
                  <Text variant="label" style={styles.sectionTitle}>
                    {group.leg}
                  </Text>
                </View>
                {group.rows.map((split, index) => (
                  <SplitRow
                    key={`${group.leg}-${split.label}-${index}`}
                    split={split}
                    index={index}
                  />
                ))}
              </View>
            ))}
          </View>
        </View>
      ) : null}

      {result.cutoffTime || result.cutoffStatus ? (
        <View style={styles.cutoffCard}>
          <Text variant="label" style={styles.splitMeta}>
            FINISH CUTOFF
          </Text>
          {result.cutoffTime ? (
            <Text variant="monoMetric" style={styles.panelText}>
              {result.cutoffTime}
            </Text>
          ) : null}
          {result.cutoffStatus ? (
            <Text
              variant="body"
              style={
                /within/i.test(result.cutoffStatus)
                  ? styles.cutoffGood
                  : styles.cutoffBad
              }
            >
              {/within/i.test(result.cutoffStatus)
                ? "Finished Within Cutoff ✓"
                : "Finished After Cutoff"}
            </Text>
          ) : null}
        </View>
      ) : null}

      <Text variant="caption" style={styles.provisionalText}>
        {result.provisional === false
          ? "OFFICIAL RESULT"
          : "PROVISIONAL RESULT · Times and rankings may change until results are finalized."}
      </Text>

      {statusCode === "FINISHED" ? (
        <Button
          label="Share Result"
          variant="secondary"
          fullWidth
          onPress={() => {
            void Share.share({
              message: [
                header.name,
                eventTitle,
                `Finish Time: ${officialTime || "—"}`,
                ...result.ranks.map((rank) => `${rank.label}: #${rank.value}`),
              ].join("\n"),
            });
          }}
        />
      ) : null}

      {statusCode === "FINISHED" &&
      result.provisional === false &&
      certificateUrl ? (
        <View style={styles.certificateAction}>
          <Button
            label="Download Certificate"
            variant="secondary"
            fullWidth
            onPress={() => {
              void Linking.openURL(certificateUrl);
            }}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: PANEL_BG,
    borderWidth: 1,
    borderColor: PANEL_BORDER,
    gap: 20,
    overflow: "hidden",
    padding: 20,
  },
  certificateAction: {
    width: "100%",
  },
  sectionSummaryGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  sectionSummaryCard: {
    backgroundColor: PANEL_BG_ELEVATED,
    borderColor: PANEL_BORDER,
    borderRadius: 12,
    borderWidth: 1,
    flexBasis: "46%",
    flexGrow: 1,
    gap: 5,
    minWidth: 130,
    padding: 12,
  },
  heroHeader: {
    alignItems: "center",
    gap: 16,
  },
  logo: {
    width: 170,
    height: 60,
  },
  nameWrap: {
    alignItems: "center",
    gap: 8,
    width: "100%",
  },
  flagNameRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    flexWrap: "wrap",
  },
  flagText: {
    lineHeight: 44,
  },
  nameText: {
    textAlign: "center",
    flexShrink: 1,
  },
  eventTitle: {
    color: PANEL_ACCENT,
    textAlign: "center",
    textTransform: "uppercase",
    fontWeight: "900",
  },
  categoryText: {
    color: PANEL_TEXT,
    textAlign: "center",
    fontWeight: "900",
  },
  raceCategoryText: {
    color: PANEL_MUTED,
    textAlign: "center",
  },
  statusText: {
    textAlign: "center",
    fontWeight: "900",
  },
  statusFinished: {
    color: "#5EE38B",
  },
  statusDnf: {
    color: "#FFB14A",
  },
  statusDns: {
    color: "#FF6B6B",
  },
  descriptionText: {
    color: PANEL_MUTED,
    textAlign: "center",
    lineHeight: 26,
  },
  congratulationsCard: {
    alignItems: "center",
    backgroundColor: "rgba(255, 214, 10, 0.08)",
    borderColor: PANEL_BORDER,
    borderRadius: 18,
    borderWidth: 1,
    gap: 8,
    padding: 16,
  },
  congratulationsTitle: {
    color: PANEL_ACCENT,
    fontWeight: "900",
    textAlign: "center",
  },
  congratulationsMessage: {
    color: PANEL_MUTED,
    lineHeight: 24,
    textAlign: "center",
  },
  finishTimeCard: {
    borderWidth: 2,
    borderColor: PANEL_ACCENT,
    borderRadius: 22,
    paddingHorizontal: 20,
    paddingVertical: 24,
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(255,255,255,0.02)",
  },
  finishTimeLabel: {
    color: PANEL_ACCENT,
    letterSpacing: 4,
  },
  finishTimeValue: {
    color: PANEL_TEXT,
    textAlign: "center",
  },
  officialDetailRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: 12,
    width: "100%",
  },
  officialDetail: {
    alignItems: "center",
    backgroundColor: PANEL_BG_ELEVATED,
    borderRadius: 12,
    flexGrow: 1,
    flexBasis: 104,
    gap: 3,
    minWidth: 96,
    padding: 10,
  },
  detailLabel: {
    color: PANEL_FAINT,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.8,
  },
  detailText: { color: PANEL_MUTED, fontWeight: "800" },
  completeProgress: {
    gap: 10,
    alignItems: "center",
    padding: 16,
    borderRadius: 18,
    backgroundColor: PANEL_BG_SOFT,
  },
  progressTrack: {
    width: "100%",
    height: 7,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.12)",
    overflow: "hidden",
  },
  progressFill: { width: "100%", height: "100%", backgroundColor: "#5EE38B" },
  rankGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  rankCard: {
    flexGrow: 1,
    flexBasis: 110,
    minWidth: 110,
    paddingHorizontal: 14,
    paddingVertical: 16,
    borderRadius: 18,
    backgroundColor: PANEL_BG_SOFT,
    alignItems: "center",
    gap: 8,
  },
  rankLabel: {
    color: PANEL_MUTED,
  },
  rankValue: {
    color: PANEL_TEXT,
  },
  section: {
    gap: 12,
  },
  sectionTitle: {
    color: PANEL_ACCENT,
    textAlign: "center",
    textTransform: "uppercase",
    fontWeight: "900",
  },
  splitTable: {
    borderRadius: 16,
    overflow: "hidden",
    backgroundColor: PANEL_BG_ELEVATED,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  splitHeader: {
    flexDirection: "row",
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  splitHeaderText: {
    flex: 1,
    color: PANEL_FAINT,
    letterSpacing: 1.5,
  },
  legHeader: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: "rgba(255,214,10,0.08)",
  },
  splitRow: {
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: PANEL_BG_ELEVATED,
  },
  splitBorder: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(255,255,255,0.08)",
  },
  splitPoint: {
    color: PANEL_TEXT,
    fontWeight: "700",
  },
  splitIdentity: { gap: 2 },
  splitMetrics: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  splitMetric: { flexGrow: 1, flexBasis: 92, minWidth: 82, gap: 3 },
  splitMeta: { color: PANEL_FAINT, fontWeight: "800" },
  splitValue: { color: PANEL_TEXT },
  cutoffCard: {
    gap: 7,
    padding: 16,
    borderRadius: 18,
    backgroundColor: PANEL_BG_SOFT,
  },
  cutoffGood: { color: "#5EE38B", fontWeight: "900" },
  cutoffBad: { color: "#FFB14A", fontWeight: "900" },
  provisionalText: {
    color: PANEL_MUTED,
    textAlign: "center",
    fontStyle: "italic",
  },
  meta: {
    backgroundColor: "rgba(255,255,255,0.05)",
    borderRadius: 18,
    gap: 10,
    padding: 16,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 16,
  },
  metaLabel: {
    color: PANEL_FAINT,
    flex: 1,
  },
  metaValue: {
    color: PANEL_TEXT,
    flex: 1.5,
    textAlign: "right",
    fontWeight: "700",
  },
  panelText: {
    color: PANEL_TEXT,
  },
});
