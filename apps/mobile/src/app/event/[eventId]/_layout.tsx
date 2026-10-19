import { Tabs, useLocalSearchParams } from "expo-router";
import type { ColorValue } from "react-native";

import { useWatchlistStore } from "@/core/store";
import { useTheme } from "@/core/theme";
import { useEvent } from "@/features/events";
import { useEventResults } from "@/features/tracking/hooks";
import { useCanonicalChangeStream } from "@/features/tracking/hooks/useCanonicalChangeStream";
import { Icon, type IconName } from "@/shared/components";

function tabIcon(name: IconName) {
  return function TabIcon({
    color,
    size,
  }: {
    color: ColorValue;
    size: number;
  }) {
    return <Icon name={name} colorValue={color as string} size={size} />;
  };
}

export default function EventLayout() {
  const theme = useTheme();
  const { eventId } = useLocalSearchParams<{
    eventId?: string | string[];
  }>();
  const id = String(
    Array.isArray(eventId) ? eventId[0] : (eventId ?? ""),
  ).trim();
  useCanonicalChangeStream(id, Boolean(id));
  const trackedCount = useWatchlistStore(
    (state) =>
      state.athletes.filter(
        (athlete) => !athlete.eventId || athlete.eventId === id,
      ).length,
  );
  const eventQuery = useEvent(id);
  const raw = eventQuery.event?.raw ?? {};
  const publicationMarked =
    raw.resultsPublished === true ||
    raw.officialResultsPublished === true ||
    raw.results_published === true ||
    raw.hasPublishedResults === true ||
    String(raw.resultState || "")
      .trim()
      .toUpperCase() === "PUBLISHED" ||
    String(raw.status || "")
      .trim()
      .toUpperCase() === "RESULTS_PUBLISHED";
  const resultsQuery = useEventResults(
    id,
    Boolean(
      id && (publicationMarked || eventQuery.event?.status === "finished"),
    ),
  );
  const hasPublishedResults =
    publicationMarked ||
    (eventQuery.event?.status === "finished" &&
      Array.isArray(resultsQuery.data) &&
      resultsQuery.data.length > 0);
  return (
    <Tabs
      initialRouteName="index"
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.colors.accent,
        tabBarInactiveTintColor: theme.colors.textMuted,
        tabBarStyle: {
          backgroundColor: theme.colors.surface,
          borderTopColor: theme.colors.border,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: "600" },
        sceneStyle: { backgroundColor: theme.colors.background },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: "Event Info", tabBarIcon: tabIcon("calendar") }}
      />
      <Tabs.Screen
        name="leaderboard"
        options={{ title: "Leaders", tabBarIcon: tabIcon("trophy") }}
      />
      <Tabs.Screen
        name="track"
        options={{
          title: "Track",
          href: hasPublishedResults ? null : undefined,
          tabBarIcon: tabIcon("map"),
          tabBarBadge: trackedCount > 0 ? trackedCount : undefined,
          tabBarBadgeStyle: {
            backgroundColor: theme.colors.accent,
            color: theme.colors.surface,
            fontSize: 10,
            fontWeight: "800",
          },
        }}
      />
      <Tabs.Screen
        name="partners"
        options={{
          title: "Partners",
          tabBarIcon: tabIcon("handshake"),
          // Sponsor management is dynamic. Keep the destination available so
          // an earlier empty response can never permanently remove this tab.
          href: undefined,
        }}
      />
      <Tabs.Screen
        name="account"
        options={{ title: "My Account", tabBarIcon: tabIcon("user") }}
      />
      <Tabs.Screen name="rules" options={{ href: null }} />
      <Tabs.Screen name="broadcast" options={{ href: null }} />
      <Tabs.Screen
        name="results"
        options={{
          title: "Results",
          href: hasPublishedResults ? undefined : null,
          tabBarIcon: tabIcon("trophy"),
        }}
      />
      <Tabs.Screen name="guidebook" options={{ href: null }} />
    </Tabs>
  );
}
