import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, View, type LayoutChangeEvent } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

import { repositories } from "@/core/repositories";
import { queryKeys } from "@/core/services/query/queryKeys";
import { Card } from "@/shared/components/ui/Card";
import { Text } from "@/shared/components/ui/Text";

export type AnnouncementTargetScreen = "home" | "account";
export type MobileAnnouncementType =
  "info" | "success" | "warning" | "urgent" | "promotion";
export type MobileAnnouncementPriority = "low" | "medium" | "high";

export interface MobileAnnouncement {
  id: string;
  title: string;
  message?: string;
  actionLabel?: string;
  actionUrl?: string;
  type: MobileAnnouncementType;
  isActive: boolean;
  startAt?: string | null;
  endAt?: string | null;
  priority: MobileAnnouncementPriority;
  tickerSpeedSeconds?: number | null;
  dismissible: boolean;
  targetScreens: AnnouncementTargetScreen[];
  createdAt: string;
  updatedAt: string;
}

const DISMISS_PREFIX = "mobile-announcement-dismissed_";
const SESSION_IMPRESSIONS = new Set<string>();
const SESSION_DISMISSALS = new Set<string>();

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

function sanitizeActionUrl(value?: string | null): string | null {
  const candidate = text(value);
  if (!candidate) return null;
  const lower = candidate.toLowerCase();
  if (
    lower.startsWith("javascript:") ||
    lower.startsWith("data:") ||
    lower.startsWith("vbscript:")
  )
    return null;
  return candidate;
}

function isSafeActionUrl(value?: string | null): boolean {
  return Boolean(sanitizeActionUrl(value));
}

function normalizeScreen(
  screen: AnnouncementTargetScreen,
): AnnouncementTargetScreen {
  return screen === "account" ? "account" : "home";
}

function stableAnnouncementKeySource(announcement: MobileAnnouncement): string {
  return [
    text(announcement.id),
    text(announcement.updatedAt),
    text(announcement.title),
    text(announcement.message),
    text(announcement.actionUrl),
    text(announcement.actionLabel),
    text(announcement.createdAt),
  ].join("|");
}

function hashAnnouncementKey(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function announcementKey(announcement: MobileAnnouncement): string | null {
  const source = stableAnnouncementKeySource(announcement);
  if (!source) return null;
  return `${DISMISS_PREFIX}${hashAnnouncementKey(source)}`;
}

async function isDismissed(announcement: MobileAnnouncement): Promise<boolean> {
  const key = announcementKey(announcement);
  if (!key) return false;
  return SESSION_DISMISSALS.has(key);
}

async function dismissAnnouncement(
  announcement: MobileAnnouncement,
): Promise<void> {
  const key = announcementKey(announcement);
  if (!key) return;
  SESSION_DISMISSALS.add(key);
}

function restoreAnnouncements(announcements: MobileAnnouncement[]): void {
  for (const announcement of announcements) {
    const key = announcementKey(announcement);
    if (key) SESSION_DISMISSALS.delete(key);
  }
}

function normalizePriority(value: unknown): MobileAnnouncementPriority {
  const normalized = text(value).toLowerCase();
  if (normalized === "high") return "high";
  if (normalized === "medium") return "medium";
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric >= 2) return "high";
  if (Number.isFinite(numeric) && numeric >= 1) return "medium";
  return "low";
}

function priorityRank(priority: MobileAnnouncementPriority): number {
  return priority === "high" ? 3 : priority === "medium" ? 2 : 1;
}

function getPriorityPalette(priority: MobileAnnouncementPriority) {
  // Match the web ticker exactly: destructive, orange-600, and slate-900.
  if (priority === "high") {
    return { background: "#EF4444", foreground: "#F8FAFC" };
  }
  if (priority === "medium") {
    return { background: "#EA580C", foreground: "#FFFFFF" };
  }
  return { background: "#0F172A", foreground: "#E2E8F0" };
}

function validAnnouncement(
  announcement: MobileAnnouncement,
  screen: AnnouncementTargetScreen,
  now = new Date(),
): boolean {
  if (!announcement.isActive) return false;
  if (!announcement.targetScreens.includes(screen)) return false;
  const startAt = announcement.startAt
    ? Date.parse(announcement.startAt)
    : null;
  const endAt = announcement.endAt ? Date.parse(announcement.endAt) : null;
  if (startAt !== null && Number.isFinite(startAt) && now.getTime() < startAt)
    return false;
  if (endAt !== null && Number.isFinite(endAt) && now.getTime() > endAt)
    return false;
  return true;
}

function resolveAnnouncement(
  input: Record<string, unknown>,
): MobileAnnouncement | null {
  const title = firstText(input.title, input.heading, input.label);
  const message = firstText(
    input.message,
    input.body,
    input.text,
    input.content,
  );
  if (!title && !message) return null;

  const targetScreensRaw = input.targetScreens;
  const targetScreens = Array.isArray(targetScreensRaw)
    ? targetScreensRaw
        .map((value) => text(value).toLowerCase())
        .flatMap((value) =>
          value === "all" || value === "both"
            ? ["home", "account"]
            : value === "home" || value === "account"
              ? [value]
              : [],
        )
    : ["home", "account"];

  return {
    id:
      firstText(input.id, input.announcementId, input.slug, input.key) ||
      crypto.randomUUID(),
    title: title || "Announcement",
    message: message || undefined,
    actionLabel:
      firstText(input.actionLabel, input.linkText, input.ctaLabel) || undefined,
    actionUrl:
      firstText(
        input.actionUrl,
        input.linkUrl,
        input.href,
        input.url,
        input.link,
        input.targetUrl,
      ) || undefined,
    type: (firstText(input.type) as MobileAnnouncementType) || "info",
    isActive: input.isActive !== false,
    startAt:
      firstText(
        input.startAt,
        input.startDate,
        input.activeFrom,
        input.startsAt,
      ) || null,
    endAt:
      firstText(input.endAt, input.endDate, input.activeTo, input.expiresAt) ||
      null,
    priority: normalizePriority(input.priority),
    tickerSpeedSeconds: Number.isFinite(Number(input.tickerSpeedSeconds))
      ? Math.min(40, Math.max(5, Number(input.tickerSpeedSeconds)))
      : null,
    dismissible: input.dismissible !== false,
    targetScreens: targetScreens as AnnouncementTargetScreen[],
    createdAt:
      firstText(input.createdAt, input.created_at) || new Date().toISOString(),
    updatedAt:
      firstText(input.updatedAt, input.updated_at) || new Date().toISOString(),
  };
}

function openAnnouncementUrl(
  url: string,
  router: ReturnType<typeof useRouter>,
) {
  const sanitized = sanitizeActionUrl(url);
  if (!sanitized) return;
  const parsed = Linking.parse(sanitized);
  if (parsed.scheme === "bergman") {
    const path = parsed.path ? `/${parsed.path.replace(/^\//, "")}` : "/";
    router.push(path as never);
    return;
  }
  if (sanitized.startsWith("/")) {
    router.push(sanitized as never);
    return;
  }
  void WebBrowser.openBrowserAsync(sanitized);
}

export function MobileAnnouncementStrip({
  screen,
}: {
  screen: AnnouncementTargetScreen;
}) {
  const router = useRouter();
  const [index, setIndex] = useState(0);
  const pulse = useSharedValue(0);
  const marqueeX = useSharedValue(0);
  const [marqueeViewportWidth, setMarqueeViewportWidth] = useState(0);
  const [marqueeContentWidth, setMarqueeContentWidth] = useState(0);
  const screenName = normalizeScreen(screen);
  const query = useQuery({
    queryKey: [...queryKeys.announcements.active, screenName] as const,
    queryFn: async ({ signal }) => {
      const res = await repositories.events.getPublicAnnouncements(
        "athlete",
        null,
        signal,
      );
      return res;
    },
    staleTime: 5 * 60_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  });

  const announcements = useMemo(() => {
    const items = Array.isArray(query.data?.announcements)
      ? query.data?.announcements
      : [];
    return items
      .map((item) => resolveAnnouncement(item as Record<string, unknown>))
      .filter((announcement): announcement is MobileAnnouncement =>
        Boolean(announcement),
      )
      .filter((announcement) => validAnnouncement(announcement, screenName))
      .sort(
        (a, b) =>
          priorityRank(b.priority) - priorityRank(a.priority) ||
          Date.parse(b.createdAt) - Date.parse(a.createdAt),
      );
  }, [query.data?.announcements, screenName]);

  const [visibleAnnouncements, setVisibleAnnouncements] = useState<
    MobileAnnouncement[]
  >([]);
  useEffect(() => {
    let alive = true;
    (async () => {
      const filtered = [];
      for (const announcement of announcements) {
        if (!(await isDismissed(announcement))) filtered.push(announcement);
      }
      if (alive) setVisibleAnnouncements(filtered);
    })();
    return () => {
      alive = false;
    };
  }, [announcements]);

  const safeIndex =
    visibleAnnouncements.length > 0 ? index % visibleAnnouncements.length : 0;
  const current = visibleAnnouncements[safeIndex];
  const hasMany = visibleAnnouncements.length > 1;

  useEffect(() => {
    if (!current) return;
    const impressionKey = `${screenName}:${current.id}:${current.updatedAt}`;
    if (SESSION_IMPRESSIONS.has(impressionKey)) return;
    SESSION_IMPRESSIONS.add(impressionKey);
    if (__DEV__) {
      console.log("[announcement] impression", {
        announcementId: current.id,
        screen: screenName,
        actionUrl: current.actionUrl,
      });
    }
  }, [current, screenName]);

  useEffect(() => {
    if (current?.priority !== "high") {
      pulse.value = 1;
      return undefined;
    }
    pulse.value = 0;
    pulse.value = withRepeat(
      withTiming(1, { duration: 1400, easing: Easing.inOut(Easing.cubic) }),
      -1,
      true,
    );
    return undefined;
  }, [current?.priority, pulse]);

  useEffect(() => {
    if (!current || marqueeViewportWidth <= 0 || marqueeContentWidth <= 0)
      return undefined;
    marqueeX.value = marqueeViewportWidth;
    const configuredSeconds = current.tickerSpeedSeconds ?? 15;
    const duration = Math.max(
      6_000,
      Math.min(40_000, configuredSeconds * 1_000),
    );
    marqueeX.value = withRepeat(
      withTiming(-marqueeContentWidth, {
        duration,
        easing: Easing.linear,
      }),
      -1,
      false,
    );
    return undefined;
  }, [current, marqueeContentWidth, marqueeViewportWidth, marqueeX]);

  useEffect(() => {
    if (!current || !hasMany) return undefined;
    const timer = setInterval(
      () => {
        setIndex((value) => (value + 1) % visibleAnnouncements.length);
      },
      Math.max(7_000, (current.tickerSpeedSeconds ?? 7) * 1_000),
    );
    return () => clearInterval(timer);
  }, [current, hasMany, visibleAnnouncements.length]);

  const pulseStyle = useAnimatedStyle(() => ({
    opacity: current?.priority === "high" ? 0.72 + pulse.value * 0.28 : 1,
    transform: [
      { scale: current?.priority === "high" ? 1 + pulse.value * 0.025 : 1 },
    ],
  }));
  const marqueeStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: marqueeX.value }],
  }));

  const onOpen = useCallback(() => {
    if (!current?.actionUrl) return;
    if (__DEV__) {
      console.log("[announcement] clicked", {
        announcementId: current.id,
        screen: screenName,
        actionUrl: current.actionUrl,
      });
    }
    openAnnouncementUrl(current.actionUrl, router);
  }, [current, router, screenName]);

  const onDismiss = useCallback(async () => {
    if (!current) return;
    await dismissAnnouncement(current);
    if (__DEV__) {
      console.log("[announcement] dismissed", {
        announcementId: current.id,
        screen: screenName,
        actionUrl: current.actionUrl,
      });
    }
    setVisibleAnnouncements((rows) =>
      rows.filter((item) => item.id !== current.id),
    );
    setIndex((value) => Math.max(0, value - 1));
  }, [current, screenName]);

  const onRestore = useCallback(() => {
    restoreAnnouncements(announcements);
    setVisibleAnnouncements(announcements);
    setIndex(0);
  }, [announcements]);

  useFocusEffect(
    useCallback(() => {
      if (!query.data && !query.isFetching) {
        void query.refetch();
      }
      return undefined;
    }, [query]),
  );

  if (query.isLoading) return null;

  if (!current) {
    if (announcements.length === 0) return null;
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Show announcements"
        onPress={onRestore}
        style={({ pressed }) => ({
          minHeight: 36,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: "rgba(234,88,12,0.34)",
          backgroundColor: pressed ? "#EA580C" : "#0F172A",
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          paddingHorizontal: 12,
          opacity: pressed ? 0.94 : 1,
        })}
      >
        <Text
          variant="caption"
          style={{ color: "#FB923C", fontWeight: "900", fontSize: 15 }}
        >
          ⚑
        </Text>
        <Text
          variant="caption"
          style={{
            color: "#E2E8F0",
            fontWeight: "900",
            fontStyle: "italic",
            letterSpacing: 0.9,
            textTransform: "uppercase",
          }}
        >
          Show announcements
        </Text>
      </Pressable>
    );
  }

  const palette = getPriorityPalette(current.priority);
  const clickable = Boolean(
    current.actionUrl && isSafeActionUrl(current.actionUrl),
  );
  const indicatorLabel = hasMany
    ? `${safeIndex + 1}/${visibleAnnouncements.length}`
    : "";
  return (
    <Card
      padded={false}
      style={{
        borderRadius: 14,
        borderWidth: 0,
        backgroundColor: palette.background,
        overflow: "hidden",
        shadowColor: palette.background,
        shadowOpacity: 0.22,
        shadowRadius: 9,
        shadowOffset: { width: 0, height: 4 },
        elevation: 4,
      }}
    >
      <View style={{ padding: 12, gap: 10 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Animated.View
            style={[
              {
                flexDirection: "row",
                alignItems: "center",
              },
              pulseStyle,
            ]}
          >
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
                borderRadius: 7,
                backgroundColor: "rgba(0,0,0,0.20)",
                paddingHorizontal: 8,
                paddingVertical: 5,
              }}
            >
              <View
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: 3.5,
                  backgroundColor: palette.foreground,
                }}
              />
              <Text
                variant="caption"
                style={{
                  color: palette.foreground,
                  fontWeight: "900",
                  fontStyle: "italic",
                  letterSpacing: 1,
                }}
              >
                LIVE
              </Text>
            </View>
          </Animated.View>
          <View style={{ flex: 1 }} />
          {hasMany ? (
            <Text
              variant="caption"
              style={{
                color: palette.foreground,
                opacity: 0.76,
                fontWeight: "900",
              }}
            >
              {indicatorLabel}
            </Text>
          ) : null}
          {current.dismissible ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Dismiss announcement"
              onPress={() => {
                void onDismiss();
              }}
              hitSlop={10}
              style={{
                width: 36,
                height: 36,
                borderRadius: 18,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: "rgba(0,0,0,0.16)",
              }}
            >
              <Text
                variant="body"
                style={{ color: palette.foreground, fontWeight: "700" }}
              >
                ×
              </Text>
            </Pressable>
          ) : null}
        </View>

        <Pressable
          accessibilityRole={clickable ? "button" : undefined}
          accessibilityLabel={
            clickable ? current.actionLabel || current.title : undefined
          }
          disabled={!clickable}
          onPress={clickable ? onOpen : undefined}
          style={({ pressed }) => ({ gap: 7, opacity: pressed ? 0.9 : 1 })}
        >
          <View
            onLayout={(event: LayoutChangeEvent) =>
              setMarqueeViewportWidth(event.nativeEvent.layout.width)
            }
            style={{ height: 25, overflow: "hidden" }}
          >
            <Animated.View
              onLayout={(event: LayoutChangeEvent) =>
                setMarqueeContentWidth(event.nativeEvent.layout.width)
              }
              style={[
                {
                  position: "absolute",
                  top: 0,
                  left: 0,
                  flexDirection: "row",
                  alignItems: "center",
                },
                marqueeStyle,
              ]}
            >
              <Text
                variant="headline"
                numberOfLines={1}
                style={{
                  color: palette.foreground,
                  fontWeight: "900",
                  fontStyle: "italic",
                  letterSpacing: 0.25,
                }}
              >
                {current.title}
                {current.actionLabel ? `   ·   ${current.actionLabel} →` : ""}
              </Text>
            </Animated.View>
          </View>
          {current.message ? (
            <Text
              variant="bodySmall"
              style={{
                color: palette.foreground,
                opacity: 0.94,
                lineHeight: 20,
                flexShrink: 1,
              }}
            >
              {current.message}
            </Text>
          ) : null}
          {current.actionLabel && clickable ? (
            <Text
              variant="caption"
              style={{
                color: palette.foreground,
                fontWeight: "900",
                marginTop: 3,
              }}
            >
              {current.actionLabel.toUpperCase()} →
            </Text>
          ) : null}
        </Pressable>

        {hasMany ? (
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
            }}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Previous announcement"
              onPress={() =>
                setIndex(
                  (value) =>
                    (value - 1 + visibleAnnouncements.length) %
                    visibleAnnouncements.length,
                )
              }
              hitSlop={8}
            >
              <Text
                variant="body"
                style={{ color: palette.foreground, fontWeight: "900" }}
              >
                ‹
              </Text>
            </Pressable>
            {visibleAnnouncements.map((announcement, itemIndex) => (
              <Pressable
                key={announcement.id}
                accessibilityRole="button"
                accessibilityLabel={`Show announcement ${itemIndex + 1}`}
                onPress={() => setIndex(itemIndex)}
                style={{
                  width: itemIndex === safeIndex ? 18 : 7,
                  height: 7,
                  borderRadius: 999,
                  backgroundColor: palette.foreground,
                  opacity: itemIndex === safeIndex ? 1 : 0.42,
                }}
              />
            ))}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Next announcement"
              onPress={() =>
                setIndex((value) => (value + 1) % visibleAnnouncements.length)
              }
              hitSlop={8}
            >
              <Text
                variant="body"
                style={{ color: palette.foreground, fontWeight: "900" }}
              >
                ›
              </Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    </Card>
  );
}
