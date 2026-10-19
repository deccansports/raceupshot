import { useMemo, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Linking from "expo-linking";
import { Image } from "expo-image";

import { useSession } from "@/core/auth";
import { useTheme } from "@/core/theme";
import { queryKeys } from "@/core/services/query/queryKeys";
import { repositories } from "@/core/repositories";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  SearchBar,
  Skeleton,
  Text,
  LeaderboardRow,
  BottomSheet,
} from "@/shared/components";
import { useDebouncedValue, useSlowNetwork } from "@/shared/hooks";
import { useWatchlist } from "@/features/tracking/watchlist/hooks/useWatchlist";
import {
  useAthleteSearch,
  useCourseGeometry,
  useCourseMap,
  useLeaderboard,
} from "@/features/tracking/hooks";
import { mapAthleteDetail } from "@/features/tracking/mappers";
import { resolveAthletePhoto } from "@/features/tracking/athletePhoto";
import { mapCourseMap } from "@/features/tracking/course-map/mappers";
import { CourseMapView } from "@/features/tracking/course-map/components/CourseMapView";
import {
  BergmanTrackerCard,
  LifecycleCard,
  OfficialResultsCard,
  PredictionCard,
  RaceProgressCard,
  RankingCard,
  CourseOverviewCard,
  CutoffCard,
} from "@/features/tracking/athlete-detail/components/cards";
import { useMobileProfile } from "@/features/dashboard/hooks/useMobileAggregates";

import { useEvent } from "../hooks/useEvents";
import { useEventTracking } from "../hooks/useEventExperience";
import { safeRouteEventId } from "../utils/eventRoute";

const PAGE_BG = "#F5F8FC";
const SURFACE_BG = "#FFFFFF";
const BERGMAN_LOGO = require("../../../../assets/images/bm.png");

type SheetMode = "collapsed" | "full";
type ContactChoice = "email" | "website" | null;

function sheetHeightFor(mode: SheetMode): number {
  if (mode === "collapsed") return 194;
  return 600;
}

function AthleteResultCard({
  title,
  bib,
  category,
  club,
  tracked,
  onAdd,
}: {
  title: string;
  bib: string;
  category?: string;
  club?: string;
  tracked?: boolean;
  onAdd: () => void;
}) {
  return (
    <Card onPress={onAdd} style={{ gap: 10 }}>
      <View style={{ gap: 2 }}>
        <Text variant="headline">{title}</Text>
        <Text variant="bodySmall" color="textMuted">
          Bib {bib}
          {club ? ` · ${club}` : ""}
          {category ? ` · ${category}` : ""}
        </Text>
      </View>
      <Text
        variant="caption"
        color={tracked ? "accent" : "textMuted"}
        style={{ fontWeight: "900" }}
      >
        {tracked ? "TRACKED" : "TAP TO TRACK"}
      </Text>
    </Card>
  );
}

function WatchedAthletePanel({
  eventId,
  eventName,
  eventStatus,
  athlete,
  onUntrack,
  onViewMap,
  profile,
}: {
  eventId: string;
  eventName?: string;
  eventStatus?: string;
  athlete: {
    id: string;
    bib: string;
    name: string;
    category?: string;
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
  };
  onUntrack: () => void;
  onViewMap: () => void;
  profile?: {
    email?: string | null;
    uid?: string | null;
    profilePhotoUrl?: string | null;
    profileUrl?: string | null;
    profileURL?: string | null;
  } | null;
}) {
  const query = useQueries({
    queries: [
      (() => {
        const identity = {
          bib: athlete.bib,
          athleteUid: athlete.athleteUid,
          bookingId: athlete.bookingId,
          providerUuid: athlete.providerUuid,
          email: athlete.email,
          participantUuid: athlete.participantUuid,
          providerAthleteUuid: athlete.providerAthleteUuid,
          providerTimingUuid: athlete.providerTimingUuid,
          providerRecordId: athlete.providerRecordId,
        };
        const hasIdentity = Boolean(
          identity.bib ||
          identity.athleteUid ||
          identity.bookingId ||
          identity.providerUuid ||
          identity.email ||
          identity.participantUuid ||
          identity.providerAthleteUuid ||
          identity.providerTimingUuid ||
          identity.providerRecordId,
        );
        return {
          queryKey: queryKeys.athleteDetail(eventId, identity),
          queryFn: ({ signal }: { signal: AbortSignal }) =>
            repositories.athlete.getDetail(
              eventId,
              identity,
              signal,
              eventStatus === "finished" ? "results" : "live",
            ),
          enabled: Boolean(eventId && hasIdentity),
          staleTime: 0,
          refetchOnMount: "always" as const,
          refetchOnWindowFocus: true,
          refetchOnReconnect: true,
        };
      })(),
    ],
  })[0];

  const detail = query.data ? mapAthleteDetail(query.data) : undefined;
  const resolvedHeaderPhoto = detail
    ? (resolveAthletePhoto(
        {
          email: detail.header.email,
          athleteUid: detail.header.athleteUid,
          photoUrl: detail.header.photo,
        },
        profile ?? null,
      ) ?? detail.header.photo)
    : undefined;

  if (query.isLoading) {
    return <Card style={{ height: 180, backgroundColor: SURFACE_BG }} />;
  }

  if (query.isError || !detail) {
    return (
      <Card style={{ gap: 10, backgroundColor: SURFACE_BG }}>
        <Text variant="headline">{athlete.name}</Text>
        <Text variant="bodySmall" color="textMuted">
          No live detail returned by backend.
        </Text>
        <Button label="Untrack" size="sm" variant="ghost" onPress={onUntrack} />
      </Card>
    );
  }

  return (
    <View style={{ gap: 10 }}>
      {detail.result ? (
        <>
          <BergmanTrackerCard
            header={{ ...detail.header, photo: resolvedHeaderPhoto }}
            statusLabel="Finished"
            metrics={detail.liveStats}
            timeline={detail.timeline}
            progress={detail.raceProgress}
            finishTime={detail.result.chipTime}
            onRemove={onUntrack}
            onViewMap={onViewMap}
          />
          <OfficialResultsCard
            header={detail.header}
            result={detail.result}
            eventName={eventName}
          />
        </>
      ) : (
        <>
          <BergmanTrackerCard
            header={{ ...detail.header, photo: resolvedHeaderPhoto }}
            statusLabel={detail.header.statusLabel}
            description={
              detail.lifecycle.frozenReason || "Live athlete tracking"
            }
            metrics={detail.liveStats}
            timeline={detail.timeline}
            progress={detail.raceProgress}
            raceStartedAt={detail.raceStartedAt}
            onRemove={onUntrack}
            onViewMap={onViewMap}
          />
          <LifecycleCard lifecycle={detail.lifecycle} />
          {detail.raceProgress ? (
            <RaceProgressCard
              progress={detail.raceProgress}
              timeline={detail.timeline}
              raceTiming={detail.raceTiming}
            />
          ) : null}
          {detail.prediction ? (
            <PredictionCard
              nextSplit={detail.nextSplit}
              projected={detail.prediction}
            />
          ) : null}
          {detail.rankings.length > 0 ? (
            <RankingCard rankings={detail.rankings} />
          ) : null}
          {detail.courseOverview.length > 0 ? (
            <CourseOverviewCard items={detail.courseOverview} />
          ) : null}
          {detail.cutoffs.length > 0 ? (
            <CutoffCard
              cutoffs={detail.cutoffs}
              status={detail.livePosition?.cutoffStatus}
            />
          ) : null}
        </>
      )}
    </View>
  );
}

export function EventTrackScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { status: sessionStatus } = useSession();
  const { eventId } = useLocalSearchParams<{ eventId: string | string[] }>();
  const id = safeRouteEventId(eventId) ?? "";
  const profileQuery = useMobileProfile(sessionStatus === "authenticated");

  const eventQuery = useEvent(id);
  const trackingQuery = useEventTracking(id);
  const courseQuery = useCourseMap(id);
  const isFinished = eventQuery.event?.status === "finished";
  const finalResultsQuery = useLeaderboard(
    id,
    { gender: "All" },
    {
      focused: true,
      isLive: eventQuery.event?.status === "live",
      enabled: Boolean(id && isFinished),
    },
    "results",
  );
  const liveRoster = (trackingQuery.data?.participants ?? []) as Record<
    string,
    unknown
  >[];
  const liveTrackingResolved =
    trackingQuery.isSuccess && Boolean(trackingQuery.data);
  const liveTrackingState = String(
    (trackingQuery.data as Record<string, unknown> | undefined)?.state ??
      "visibility-disabled",
  );
  const publicAthleteVisibilityEnabled =
    (trackingQuery.data as Record<string, unknown> | undefined)
      ?.publicAthleteVisibility === true &&
    liveTrackingState !== "visibility-disabled";
  const liveTrackingDataPending = liveTrackingState === "data-pending";
  const athleteInteractionsEnabled =
    publicAthleteVisibilityEnabled && !liveTrackingDataPending;
  const { athletes, addAthlete, toggle } = useWatchlist(id, liveRoster);
  const selectedMapAthlete = athletes.find(
    (athlete) => !athlete.eventId || athlete.eventId === id,
  );
  const geometryQuery = useCourseGeometry(id, eventQuery.event?.raw, Boolean(selectedMapAthlete), {
    ticketId: selectedMapAthlete?.ticketId,
    contestId:
      selectedMapAthlete?.providerContestUuid ??
      selectedMapAthlete?.contestUuid,
    contestName: selectedMapAthlete?.category,
  });

  const [search, setSearch] = useState("");
  const debounced = useDebouncedValue(search, 200);
  const searchMode = /^\d+$/.test(debounced.trim()) ? "bib" : "name";
  const searchQuery = useAthleteSearch(
    id,
    debounced,
    searchMode,
    Boolean(id && athleteInteractionsEnabled),
    "live",
  );
  const trackerSlow = useSlowNetwork(trackingQuery.isLoading || trackingQuery.isFetching);
  const searchSlow = useSlowNetwork(searchQuery.isFetching);

  const courseMap = useMemo(
    () =>
      mapCourseMap(
        courseQuery.data?.courseIndex,
        geometryQuery.data ?? undefined,
        selectedMapAthlete
          ? {
              id:
                selectedMapAthlete.providerContestUuid ??
                selectedMapAthlete.contestUuid,
              name: selectedMapAthlete.category,
            }
          : undefined,
        courseQuery.data?.timingConfiguration,
      ),
    [courseQuery.data, geometryQuery.data, selectedMapAthlete],
  );

  const watchedRows = athletes.filter(
    (athlete) => !athlete.eventId || athlete.eventId === id,
  );
  const [sheetMode, setSheetMode] = useState<SheetMode>("full");
  const [contactChoice, setContactChoice] = useState<ContactChoice>(null);
  const panelVisible = sheetMode !== "collapsed";

  const backToEventInfo = () => {
    if (!id) return;
    router.replace({ pathname: "/event/[eventId]", params: { eventId: id } });
  };

  const openContactUs = () => {
    setContactChoice("website");
  };

  const openContactUrl = () => {
    void Linking.openURL("https://raceupshot.com/contact-us");
  };

  const openContactEmail = () => {
    void Linking.openURL(
      "mailto:info@raceupshot.com?subject=Contact%20Race%20Upshot%20Track",
    );
  };

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: PAGE_BG }}
      edges={["top", "left", "right"]}
    >
      <View style={{ flex: 1, backgroundColor: PAGE_BG }}>
        <View style={{ flex: 1 }}>
          <CourseMapView
            map={courseMap}
            cutoffMinutes={eventQuery.event?.cutoffMinutes}
            cutoffs={eventQuery.event?.cutoffs}
            fullBleed
            refreshError={
              courseQuery.isRefetchError || geometryQuery.isRefetchError
            }
          />

          <View
            style={{
              position: "absolute",
              top: theme.spacing.base,
              left: theme.spacing.base,
              right: theme.spacing.base,
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "flex-start",
              gap: 12,
            }}
          >
            <View
              style={{ flexDirection: "row", alignItems: "center", gap: 10 }}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Back to event info"
                onPress={backToEventInfo}
                style={{
                  width: 42,
                  height: 42,
                  borderRadius: 21,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: "rgba(255,255,255,0.14)",
                  borderWidth: 1,
                  borderColor: "rgba(255,255,255,0.18)",
                }}
              >
                <Image
                  source={BERGMAN_LOGO}
                  style={{ width: 28, height: 28 }}
                  contentFit="contain"
                />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Back to event info"
                onPress={backToEventInfo}
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 20,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: "rgba(255,255,255,0.14)",
                  borderWidth: 1,
                  borderColor: "rgba(255,255,255,0.18)",
                }}
              >
                <Text
                  variant="headline"
                  style={{ color: "#FFFFFF", lineHeight: 24 }}
                >
                  ←
                </Text>
              </Pressable>
            </View>
          </View>

          {panelVisible ? (
            <Pressable
              onPress={() => setSheetMode("collapsed")}
              style={[
                StyleSheet.absoluteFill,
                { backgroundColor: "transparent" },
              ]}
            />
          ) : null}
        </View>

        <BottomSheet
          inline
          visible={panelVisible}
          onClose={() => setSheetMode("collapsed")}
          height={sheetHeightFor(sheetMode)}
        >
          <ScrollView
            contentContainerStyle={{
              gap: theme.spacing.md,
              flexGrow: 1,
              paddingBottom: theme.spacing.lg,
            }}
            showsVerticalScrollIndicator={false}
          >
            <View style={{ position: "relative", paddingTop: 2 }}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close tracker panel"
                onPress={() => setSheetMode("collapsed")}
                style={{
                  position: "absolute",
                  right: 0,
                  top: 0,
                  width: 32,
                  height: 32,
                  borderRadius: 16,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: theme.colors.surfaceSunken,
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                  zIndex: 2,
                }}
              >
                <Text
                  variant="headline"
                  style={{ color: theme.colors.textPrimary, lineHeight: 18 }}
                >
                  ×
                </Text>
              </Pressable>
              <View style={{ gap: 2, paddingRight: 40 }}>
                <Text variant="headline">Race Upshot Track</Text>
              </View>
            </View>

            <Card
              style={{
                gap: theme.spacing.xs,
                paddingVertical: theme.spacing.sm,
              }}
            >
              <SearchBar
                value={search}
                onChangeText={(value) => {
                  setSearch(value);
                  if (value.trim().length > 0 && sheetMode !== "full")
                    setSheetMode("full");
                }}
                onClear={() => setSearch("")}
                placeholder="Search athlete by bib or name"
              />
            </Card>

            {trackingQuery.isLoading || (trackingQuery.isFetching && !trackingQuery.data) ? (
              <View style={{ gap: theme.spacing.sm }}>
                <Skeleton height={88} radius={theme.radius.large} />
                <Text variant="bodySmall" color="textMuted">
                  {trackerSlow ? "Slow network detected. The tracker is still loading." : "Loading live tracker..."}
                </Text>
              </View>
            ) : liveTrackingResolved && !publicAthleteVisibilityEnabled ? (
              <EmptyState
                title="Live tracking unavailable"
                description="Athlete tracking is currently unavailable."
              />
            ) : liveTrackingResolved && liveTrackingDataPending ? (
              <EmptyState
                title="Live tracking is being prepared"
                description="Athlete data is yet to be mapped. Please check again later."
              />
            ) : debounced.trim().length > 0 ? (
              <View style={{ gap: theme.spacing.sm }}>
                <View
                  style={{
                    flexDirection: "row",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <Text variant="headline">Search results</Text>
                  <Badge
                    label={`${searchQuery.data?.length ?? 0} found`}
                    variant="neutral"
                  />
                </View>
                {searchQuery.isFetching ? (
                  <View style={{ gap: theme.spacing.sm }}>
                    <Skeleton height={88} radius={theme.radius.large} />
                    <Text variant="bodySmall" color="textMuted">
                      {searchSlow ? "Slow network detected. Your athlete search is still loading." : "Searching live athletes..."}
                    </Text>
                  </View>
                ) : (searchQuery.data ?? []).length > 0 ? (
                  (searchQuery.data ?? []).map((athlete) => {
                    const tracked = watchedRows.some(
                      (row) => row.id === athlete.id || row.bib === athlete.bib,
                    );
                    return (
                      <AthleteResultCard
                        key={athlete.id}
                        title={athlete.name}
                        bib={athlete.bib}
                        category={athlete.category}
                        club={athlete.club}
                        tracked={tracked}
                        onAdd={() => {
                          if (tracked) return;
                          addAthlete({
                            id: athlete.id,
                            bib: athlete.bib,
                            name: athlete.name,
                            eventId: id,
                            category: athlete.category,
                            club: athlete.club,
                            photoUrl: athlete.photoUrl,
                            participantUuid: athlete.participantUuid,
                            providerUuid: athlete.providerUuid,
                            providerAthleteUuid: athlete.providerAthleteUuid,
                            providerTimingUuid: athlete.providerTimingUuid,
                            providerRecordId: athlete.providerRecordId,
                            athleteUid: athlete.athleteUid,
                            bookingId: athlete.bookingId,
                          });
                        }}
                      />
                    );
                  })
                ) : (
                  <EmptyState
                    title="No athletes found"
                    description={`No athletes match “${debounced}”.`}
                  />
                )}
              </View>
            ) : (
              <Text variant="bodySmall" color="textMuted">
                Start typing to search the live athlete roster.
              </Text>
            )}

            {isFinished ? (
              <View style={{ gap: theme.spacing.sm }}>
                <Text variant="headline">Final Results</Text>
                {finalResultsQuery.isLoading ||
                (finalResultsQuery.isFetching &&
                  (finalResultsQuery.data ?? []).length === 0) ? (
                  <>
                    <Skeleton height={62} radius={theme.radius.medium} />
                    <Skeleton height={62} radius={theme.radius.medium} />
                    <Skeleton height={62} radius={theme.radius.medium} />
                  </>
                ) : (finalResultsQuery.data ?? []).length > 0 ? (
                  (finalResultsQuery.data ?? [])
                    .slice(0, 12)
                    .map((item: any) => (
                      <LeaderboardRow
                        key={String(item.id ?? item.bib ?? item.name)}
                        rank={Number(item.rank ?? 0) || 0}
                        name={item.name ?? "Athlete"}
                        time={item.time ?? "—"}
                        detail={item.detail}
                        avatarUri={item.avatarUri}
                        avatarSeed={item.avatarSeed}
                      />
                    ))
                ) : (
                  <EmptyState
                    title="No results returned by backend"
                    description="Official finish results will appear here once KV is available."
                  />
                )}
              </View>
            ) : (
              <View style={{ gap: theme.spacing.sm }}>
                <Text variant="headline">Live Athletes</Text>
                {watchedRows.length > 0 ? (
                  watchedRows.map((athlete) => (
                    <WatchedAthletePanel
                      key={athlete.id}
                      eventId={id}
                      eventName={eventQuery.event?.name}
                      eventStatus={eventQuery.event?.status}
                      athlete={athlete}
                      onUntrack={() => toggle(athlete.id)}
                      onViewMap={() => setSheetMode("collapsed")}
                      profile={profileQuery.data ?? null}
                    />
                  ))
                ) : (
                  <EmptyState
                    title="No athletes tracked"
                    description="You aren’t tracking any athletes yet. Search for an athlete to start tracking."
                  />
                )}
              </View>
            )}

            {courseMap ? (
              <Card style={{ gap: theme.spacing.sm }}>
                <Text variant="headline">Course Map</Text>
                <Text variant="bodySmall" color="textMuted">
                  Full-screen map is shown behind the tracker panel.
                </Text>
              </Card>
            ) : null}

            <View
              style={{
                gap: 10,
                paddingTop: theme.spacing.sm,
                paddingBottom: theme.spacing.xs,
              }}
            >
              <Text
                variant="caption"
                style={{
                  color: theme.colors.textMuted,
                  textAlign: "center",
                  fontWeight: "700",
                }}
              >
                Preliminary: Times and locations are subject to change.
              </Text>
              <Button
                label="Contact us"
                variant="secondary"
                fullWidth
                onPress={openContactUs}
              />
              <Text
                variant="caption"
                style={{ color: theme.colors.textMuted, textAlign: "center" }}
              >
                info@raceupshot.com
              </Text>
              <Pressable
                accessibilityRole="link"
                accessibilityLabel="Open Race Upshot contact us page"
                onPress={openContactUrl}
                style={{ alignSelf: "center" }}
              >
                <Text
                  variant="caption"
                  style={{
                    color: theme.colors.accent,
                    textDecorationLine: "underline",
                    fontWeight: "700",
                  }}
                >
                  raceupshot.com/contact
                </Text>
              </Pressable>
            </View>
          </ScrollView>
        </BottomSheet>

        {contactChoice ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close contact choices"
            onPress={() => setContactChoice(null)}
            style={[
              StyleSheet.absoluteFill,
              {
                backgroundColor: "rgba(0,0,0,0.35)",
                justifyContent: "center",
                padding: theme.spacing.base,
              },
            ]}
          >
            <Pressable
              onPress={() => undefined}
              style={{
                backgroundColor: theme.colors.surfaceElevated,
                borderRadius: theme.radius.large,
                padding: theme.spacing.base,
                gap: theme.spacing.sm,
              }}
            >
              <Text variant="headline">Contact us</Text>
              <Text variant="bodySmall" color="textMuted">
                Choose how you want to contact Race Upshot.
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setContactChoice(null);
                  openContactEmail();
                }}
                style={{
                  paddingHorizontal: 14,
                  paddingVertical: 12,
                  borderRadius: theme.radius.medium,
                  backgroundColor: theme.colors.accent,
                }}
              >
                <Text variant="label" style={{ color: theme.colors.onAccent }}>
                  Email info@raceupshot.com
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setContactChoice(null);
                  openContactUrl();
                }}
                style={{
                  paddingHorizontal: 14,
                  paddingVertical: 12,
                  borderRadius: theme.radius.medium,
                  backgroundColor: theme.colors.surfaceSunken,
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                }}
              >
                <Text
                  variant="label"
                  style={{ color: theme.colors.textPrimary }}
                >
                  Open raceupshot.com/contact
                </Text>
              </Pressable>
            </Pressable>
          </Pressable>
        ) : null}

        {sheetMode === "collapsed" ? (
          <Pressable
            onPress={() => setSheetMode("full")}
            style={{
              position: "absolute",
              right: theme.spacing.base,
              bottom: theme.spacing.base + 64,
              borderRadius: 999,
              backgroundColor: "rgba(11,13,18,0.85)",
              paddingHorizontal: 14,
              paddingVertical: 10,
            }}
          >
            <Text
              variant="caption"
              style={{ color: "#FFFFFF", fontWeight: "700" }}
            >
              Show tracker
            </Text>
          </Pressable>
        ) : null}
      </View>
    </SafeAreaView>
  );
}
