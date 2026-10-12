import { useMemo } from "react";
import {
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  useWindowDimensions,
  View,
} from "react-native";
import { Image } from "expo-image";
import { useGlobalSearchParams, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import type { EventPartner } from "@/core/repositories/events.repository";
import { useTheme } from "@/core/theme";
import { EmptyState, ErrorState, Skeleton, Text } from "@/shared/components";
import { useEventPartners } from "@/features/events/hooks/useEvents";
import { safeRouteEventId } from "@/features/events/utils/eventRoute";

function categoryLabel(partner: EventPartner): string {
  return (
    String(partner.type ?? "Official Partner").trim() || "Official Partner"
  );
}

export function EventPartnersScreen() {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const params = useLocalSearchParams<{ eventId?: string | string[] }>();
  const globalParams = useGlobalSearchParams<{
    eventId?: string | string[];
  }>();
  const eventId =
    safeRouteEventId(
      Array.isArray(params.eventId) ? params.eventId[0] : params.eventId,
      Array.isArray(globalParams.eventId)
        ? globalParams.eventId[0]
        : globalParams.eventId,
    ) ?? "";
  const query = useEventPartners(eventId);
  const horizontalPadding =
    width >= theme.breakpoints.md ? theme.spacing.xl : theme.spacing.lg;
  const contentWidth = Math.min(width, theme.maxContentWidth);
  const availableGridWidth = Math.max(0, contentWidth - horizontalPadding * 2);
  const columns =
    availableGridWidth >= 560 ? 3 : availableGridWidth >= 300 ? 2 : 1;
  const gridGap = theme.spacing.md;
  const cardWidth = Math.floor(
    (availableGridWidth - gridGap * (columns - 1)) / columns,
  );
  const sponsors = useMemo(
    () => query.data?.sponsors ?? [],
    [query.data?.sponsors],
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <ScrollView
        contentContainerStyle={{
          alignSelf: "center",
          width: "100%",
          maxWidth: theme.maxContentWidth,
          paddingHorizontal: horizontalPadding,
          paddingTop: theme.spacing.lg,
          paddingBottom: theme.spacing.xxxl,
          gap: theme.spacing.xl,
        }}
        refreshControl={
          <RefreshControl
            refreshing={query.isFetching && sponsors.length > 0}
            onRefresh={() => void query.refetch()}
            tintColor={theme.colors.accent}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        <View
          style={{
            backgroundColor: theme.colors.surface,
            borderColor: theme.colors.border,
            borderRadius: theme.radius.xl,
            borderWidth: 1,
            overflow: "hidden",
          }}
        >
          <View style={{ height: 5, flexDirection: "row" }}>
            <View style={{ flex: 2, backgroundColor: theme.colors.accent }} />
            <View
              style={{ flex: 1, backgroundColor: theme.colors.accentSecondary }}
            />
          </View>
          <View style={{ padding: theme.spacing.lg, gap: theme.spacing.xs }}>
            <Text
              variant="label"
              style={{
                color: theme.colors.accent,
                fontWeight: "900",
                letterSpacing: 1.5,
              }}
            >
              RACE PARTNERS
            </Text>
            <Text variant="display">Partners</Text>
            <Text variant="body" color="textMuted">
              Official supporters powering this Bergman event.
            </Text>
          </View>
        </View>

        {query.isLoading || (query.isFetching && sponsors.length === 0) ? (
          <View
            style={{
              flexDirection: "row",
              flexWrap: "wrap",
              gap: gridGap,
            }}
          >
            {Array.from({ length: columns * 2 }, (_, item) => (
              <View key={item} style={{ width: cardWidth }}>
                <Skeleton height={196} radius={theme.radius.large} />
              </View>
            ))}
          </View>
        ) : query.isError ? (
          <ErrorState
            title="Partners unavailable"
            onRetry={() => void query.refetch()}
          />
        ) : sponsors.length === 0 ? (
          <EmptyState title="Event partners coming soon" />
        ) : (
          <View
            style={{
              flexDirection: "row",
              flexWrap: "wrap",
              gap: gridGap,
            }}
          >
            {sponsors.map((partner, index) => {
              const label = categoryLabel(partner);
              const accentColor =
                index % 2 === 0
                  ? theme.colors.accent
                  : theme.colors.accentSecondary;
              return (
                <Pressable
                  key={partner.id}
                  accessibilityRole={partner.website ? "link" : undefined}
                  accessibilityLabel={`${partner.name}, ${label}`}
                  disabled={!partner.website}
                  onPress={() =>
                    partner.website
                      ? void Linking.openURL(partner.website)
                      : undefined
                  }
                  style={({ pressed }) => ({
                    width: cardWidth,
                    minHeight: 196,
                    backgroundColor: theme.colors.surface,
                    borderColor: pressed ? accentColor : theme.colors.border,
                    borderRadius: theme.radius.large,
                    borderWidth: 1,
                    overflow: "hidden",
                    opacity: pressed ? 0.88 : 1,
                    transform: [{ scale: pressed ? 0.985 : 1 }],
                    ...theme.shadows.card,
                  })}
                >
                  <View style={{ height: 4, backgroundColor: accentColor }} />
                  <View
                    style={{
                      flex: 1,
                      minHeight: 191,
                      padding: theme.spacing.md,
                      gap: theme.spacing.sm,
                    }}
                  >
                    <View
                      style={{
                        alignSelf: "flex-start",
                        maxWidth: "100%",
                        backgroundColor: theme.colors.surfaceSunken,
                        borderRadius: theme.radius.full,
                        paddingHorizontal: theme.spacing.sm,
                        paddingVertical: 5,
                      }}
                    >
                      <Text
                        variant="caption"
                        numberOfLines={1}
                        style={{
                          color: accentColor,
                          fontWeight: "900",
                          letterSpacing: 0.7,
                          textTransform: "uppercase",
                        }}
                      >
                        {label}
                      </Text>
                    </View>
                    <View
                      style={{
                        flex: 1,
                        minHeight: 92,
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Image
                        source={{ uri: partner.logoUrl }}
                        alt={`${partner.name} logo`}
                        contentFit="contain"
                        transition={180}
                        cachePolicy="memory-disk"
                        style={{ width: "92%", height: 78 }}
                      />
                    </View>
                    <Text
                      variant="bodySmall"
                      numberOfLines={2}
                      style={{
                        minHeight: 36,
                        textAlign: "center",
                        fontWeight: "900",
                      }}
                    >
                      {partner.name}
                    </Text>
                    {partner.website ? (
                      <Text
                        variant="caption"
                        style={{
                          color: accentColor,
                          textAlign: "center",
                          fontWeight: "800",
                        }}
                      >
                        VISIT PARTNER →
                      </Text>
                    ) : null}
                  </View>
                </Pressable>
              );
            })}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
