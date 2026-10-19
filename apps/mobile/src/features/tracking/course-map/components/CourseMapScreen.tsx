import { useQueries } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMemo } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { repositories } from "@/core/repositories";
import { queryKeys } from "@/core/services/query/queryKeys";
import { useTheme } from "@/core/theme";
import { mapAthleteDetail } from "@/features/tracking/mappers";
import { useCourseGeometry, useCourseMap, useParticipants } from "@/features/tracking/hooks";
import { useWatchlist } from "@/features/tracking/watchlist";
import { Icon, Skeleton, Text } from "@/shared/components";

import {
  buildCumulativePath,
  distanceToFraction,
  positionAtFraction,
} from "../../engine";
import { mapCourseMap } from "../mappers";
import { CourseMapView } from "./CourseMapView";
import type { TrackAthlete } from "./CourseTrackCanvas";
import { useEvent } from "@/features/events/hooks/useEvents";
import { safeRouteEventId } from "@/features/events/utils/eventRoute";

export function CourseMapScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { eventId } = useLocalSearchParams<{ eventId: string | string[] }>();
  const id = safeRouteEventId(eventId) ?? '';
  const { event } = useEvent(id);
  const participantRoster = useParticipants(id, Boolean(id));
  const roster = useMemo(
    () => Array.isArray(participantRoster.data) ? participantRoster.data as Record<string, unknown>[] : [],
    [participantRoster.data],
  );
  const { athletes: trackedAthletes } = useWatchlist(id, roster);
  const query = useCourseMap(id);
  const selectedMapAthlete = trackedAthletes.find(
    (athlete) => !athlete.eventId || athlete.eventId === id,
  );
  const geometry = useCourseGeometry(id, event?.raw, true, {
    ticketId: selectedMapAthlete?.ticketId,
    contestId:
      selectedMapAthlete?.providerContestUuid ?? selectedMapAthlete?.contestUuid,
    contestName: selectedMapAthlete?.category,
  });
  const courseMap = useMemo(
    () =>
      mapCourseMap(
        query.data?.courseIndex,
        geometry.data ?? undefined,
        selectedMapAthlete
          ? {
              id:
                selectedMapAthlete.providerContestUuid ??
                selectedMapAthlete.contestUuid,
              name: selectedMapAthlete.category,
            }
          : undefined,
        query.data?.timingConfiguration,
      ),
    [query.data, geometry.data, selectedMapAthlete],
  );
  const trackedForEvent = useMemo(
    () => trackedAthletes.filter((a) => !a.eventId || a.eventId === id),
    [id, trackedAthletes],
  );
  const athleteQueries = useQueries({
    queries: trackedForEvent.map((athlete) => {
      const identity = {
        bib: athlete.bib,
        athleteUid: athlete.athleteUid,
        bookingId: athlete.bookingId,
        participantUuid: athlete.participantUuid,
        providerAthleteUuid: athlete.providerAthleteUuid,
        providerTimingUuid: athlete.providerTimingUuid,
        providerRecordId: athlete.providerRecordId,
        providerUuid: athlete.providerUuid,
      };
      const hasIdentity = Boolean(
        identity.bib ||
        identity.athleteUid ||
        identity.bookingId ||
        identity.participantUuid ||
        identity.providerAthleteUuid ||
        identity.providerTimingUuid ||
        identity.providerRecordId ||
        identity.providerUuid,
      );
      return {
        queryKey: queryKeys.athleteDetail(id, identity),
        queryFn: ({ signal }: { signal: AbortSignal }) =>
          repositories.athlete.getDetail(
            id,
            identity,
            signal,
            event?.status === "finished" ? "results" : "live",
          ),
        enabled: Boolean(id && hasIdentity),
        staleTime: 0,
        refetchOnMount: "always" as const,
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
      };
    }),
  });
  const mapAthletes = useMemo<TrackAthlete[]>(() => {
    if (
      !courseMap?.hasGeometry ||
      !courseMap.bounds ||
      courseMap.mergedPath.length < 2
    )
      return [];
    const cumPath = buildCumulativePath(courseMap.mergedPath);
    return athleteQueries
      .map((athleteQuery) => {
        if (!athleteQuery.data) return undefined;
        const detail = mapAthleteDetail(athleteQuery.data);
        const isPending = !Boolean(detail?.liveLocation || detail?.track);
        const position =
          (detail?.liveLocationSource === 'GPS' ? detail.liveLocation : undefined) ??
          (detail.track
            ? positionAtFraction(
                cumPath,
                distanceToFraction(
                  detail.track.seed.anchorKm,
                  detail.track.totalKm,
                ),
              )
            : cumPath.points[0]);
        const safePosition = position ?? cumPath.points[0];
        if (!safePosition) return undefined;
        const marker: TrackAthlete = {
          position: safePosition,
          name: detail.header.name,
          bib: detail.header.bib,
        };
        if (detail.header.photo) marker.photoUrl = detail.header.photo;
        if (detail.header.colorSeed) marker.colorSeed = detail.header.colorSeed;
        if (isPending) marker.isPending = true;
        return marker;
      })
      .filter((athlete): athlete is TrackAthlete => Boolean(athlete));
  }, [athleteQueries, courseMap]);

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: theme.colors.background }}
      edges={["top", "left", "right"]}
    >
      <ScrollView
        contentContainerStyle={{
          padding: theme.spacing.base,
          gap: theme.spacing.md,
          paddingBottom: 40,
        }}
        showsVerticalScrollIndicator={false}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: theme.spacing.sm,
          }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Go back"
            hitSlop={8}
            onPress={() => {
              if (!id) {
                router.replace("/events");
                return;
              }
              router.replace({
                pathname: "/event/[eventId]",
                params: { eventId: id },
              });
            }}
          >
            <Icon name="chevronLeft" />
          </Pressable>
          <Text variant="display">Course Map</Text>
        </View>

        {query.isLoading || geometry.isLoading ? (
          <Skeleton height={260} radius={theme.radius.large} />
        ) : (
          <CourseMapView
            map={courseMap}
            athletes={mapAthletes}
            cutoffMinutes={event?.cutoffMinutes}
            cutoffs={event?.cutoffs}
            refreshError={query.isRefetchError || geometry.isRefetchError}
          />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
