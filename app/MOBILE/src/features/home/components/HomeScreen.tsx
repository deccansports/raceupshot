import { useRouter } from "expo-router";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  Platform,
  Linking,
  Pressable,
  ScrollView,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type LayoutChangeEvent,
  type TextStyle,
} from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { getCountdownParts } from "@bergman/live-tracking-contracts/countdown";
import { Image } from "expo-image";
import { useQuery } from "@tanstack/react-query";

import { useTheme } from "@/core/theme";
import { repositories, type HomepageSliderItem } from "@/core/repositories";
import { queryKeys } from "@/core/services/query/queryKeys";
import {
  Card,
  EmptyState,
  EventCard,
  Icon,
  MobileAnnouncementStrip,
  SearchBar,
  Skeleton,
  Text,
} from "@/shared/components";
import type { LiveEventItem } from "@/features/events";

import { useHomeFeed } from "../hooks/useHomeFeed";
import { safeRouteEventId } from "@/features/events/utils/eventRoute";
import {
  getMobileEventPrimaryCta,
  mobileEventCtaLabel,
  type MobileEventPrimaryCtaType,
} from "@/features/events/utils/eventPrimaryCta";

const BERGMAN_LOGO = require("../../../../assets/images/bm.png");
const BERGMAN_HEADER_MARK = require("../../../../assets/images/favicon.png");

function linkedEventDates(event?: LiveEventItem): Date[] {
  if (!event) return [];
  const scheduleValues = Array.isArray(event.disciplineSchedule)
    ? event.disciplineSchedule.flatMap((item) => {
        if (typeof item === "string") return [item];
        if (!item || typeof item !== "object") return [];
        const row = item as Record<string, unknown>;
        const value = row.date ?? row.eventDate ?? row.raceDate;
        return typeof value === "string" ? [value] : [];
      })
    : [];
  const ticketValues = (event.ticketDefinitions ?? []).flatMap((ticket) => {
    const value =
      ticket.eventDate ??
      ticket.raceDate ??
      ticket.ticketEventDate ??
      ticket.date;
    return typeof value === "string" ? [value] : [];
  });
  const values = [
    ...ticketValues,
    ...scheduleValues,
    event.startDate,
    event.endDate,
  ];
  const unique = new Map<string, Date>();
  for (const value of values) {
    const date = parseDate(value);
    if (!date) continue;
    const key = date.toISOString().slice(0, 10);
    if (!unique.has(key)) unique.set(key, date);
  }
  return [...unique.values()].sort((a, b) => a.getTime() - b.getTime());
}

function countdownParts(event: LiveEventItem | undefined, now: number) {
  const countdown = getCountdownParts(
    event?.countdownTargetAt || event?.startAt,
    now,
  );
  return countdown.valid ? countdown : null;
}

function HomeHeroCarousel({
  items,
  events,
  onSettings,
  onJump,
  onOpenEvent,
  onPrimary,
}: {
  items: HomepageSliderItem[];
  events: LiveEventItem[];
  onSettings: () => void;
  onJump: (section: "Live" | "Upcoming" | "Past") => void;
  onOpenEvent: (eventId: string) => void;
  onPrimary: (event: LiveEventItem, type: MobileEventPrimaryCtaType) => void;
}) {
  const router = useRouter();
  const { width: windowWidth } = useWindowDimensions();
  const slideWidth = Math.max(280, windowWidth - 32);
  const slideHeight = Math.max(330, Math.min(500, slideWidth * 1.04));
  const carouselRef = useRef<ScrollView>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const imageItems = useMemo(
    () =>
      items.filter(
        (item) =>
          String(item.type || "image").toLowerCase() !== "video" &&
          Boolean(String(item.mobileSrc || item.src || "").trim()),
      ),
    [items],
  );

  useEffect(() => {
    if (imageItems.length <= 1) return undefined;
    const timer = setInterval(() => {
      setActiveIndex((current) => {
        const next = (current + 1) % imageItems.length;
        carouselRef.current?.scrollTo({ x: next * slideWidth, animated: true });
        return next;
      });
    }, 7_000);
    return () => clearInterval(timer);
  }, [imageItems.length, slideWidth]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (activeIndex < imageItems.length) return;
    const reset = setTimeout(() => {
      setActiveIndex(0);
      carouselRef.current?.scrollTo({ x: 0, animated: false });
    }, 0);
    return () => clearTimeout(reset);
  }, [activeIndex, imageItems.length]);

  const onMomentumScrollEnd = (
    event: NativeSyntheticEvent<NativeScrollEvent>,
  ) => {
    const next = Math.max(
      0,
      Math.min(
        imageItems.length - 1,
        Math.round(event.nativeEvent.contentOffset.x / slideWidth),
      ),
    );
    setActiveIndex(next);
  };

  const openSlide = (item: HomepageSliderItem) => {
    const linkedEvent = item.eventId
      ? events.find((event) => (event.eventId || event.id) === item.eventId)
      : undefined;
    if (linkedEvent) {
      onPrimary(linkedEvent, getMobileEventPrimaryCta(linkedEvent));
      return;
    }
    if (item.customUrl) {
      if (/^https?:\/\//i.test(item.customUrl)) {
        void Linking.openURL(item.customUrl);
        return;
      }
      router.push(item.customUrl as never);
      return;
    }
    if (item.eventId) onOpenEvent(item.eventId);
  };

  return (
    <View
      style={{
        width: slideWidth,
        borderRadius: 26,
        overflow: "hidden",
        backgroundColor: "#07111F",
      }}
    >
      {imageItems.length > 0 ? (
        <ScrollView
          ref={carouselRef}
          horizontal
          pagingEnabled
          bounces={false}
          decelerationRate="fast"
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={onMomentumScrollEnd}
          scrollEventThrottle={16}
          accessibilityRole="adjustable"
          accessibilityLabel="BERGMAN homepage banners"
          style={{ height: slideHeight }}
        >
          {imageItems.map((item) => {
            const actionable = Boolean(item.customUrl || item.eventId);
            const linkedEvent = item.eventId
              ? events.find(
                  (event) => (event.eventId || event.id) === item.eventId,
                )
              : undefined;
            const dates = linkedEventDates(linkedEvent);
            const countdown = countdownParts(linkedEvent, now);
            const ctaType = linkedEvent
              ? getMobileEventPrimaryCta(linkedEvent)
              : "DETAILS";
            const isGenericSlide = !linkedEvent && !item.header;
            return (
              <View
                key={item.id}
                accessibilityRole="image"
                accessibilityLabel={item.alt || item.header || "BERGMAN banner"}
                style={{
                  width: slideWidth,
                  height: slideHeight,
                  backgroundColor: "#07111F",
                }}
              >
                <Image
                  source={{ uri: String(item.mobileSrc || item.src) }}
                  style={{ width: slideWidth, height: slideHeight }}
                  contentFit="cover"
                  contentPosition={{
                    left: `${item.mobileFocusX ?? 50}%`,
                    top: `${item.mobileFocusY ?? 50}%`,
                  }}
                  transition={240}
                  recyclingKey={item.id}
                  accessibilityLabel={
                    item.alt || item.header || "BERGMAN banner"
                  }
                />
                <View
                  pointerEvents="none"
                  style={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    top: 0,
                    bottom: 0,
                    backgroundColor: "rgba(2,8,18,0.30)",
                  }}
                />
                {actionable ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Open ${item.alt || item.header || linkedEvent?.name || "BERGMAN banner"}`}
                    onPress={() => openSlide(item)}
                    style={{
                      position: "absolute",
                      left: 0,
                      right: 0,
                      top: 0,
                      bottom: 0,
                    }}
                  />
                ) : null}
                <View
                  pointerEvents={actionable ? "none" : "auto"}
                  style={{
                    position: "absolute",
                    left: 12,
                    right: 12,
                    bottom: 16,
                    gap: 9,
                    padding: 13,
                    borderRadius: 16,
                    backgroundColor: "rgba(3,10,20,0.78)",
                    borderWidth: 1,
                    borderColor: "rgba(255,255,255,0.16)",
                  }}
                >
                  <Text
                    variant="title"
                    style={{
                      color: "#FFFFFF",
                      fontWeight: "900",
                      fontStyle: "italic",
                      textTransform: "uppercase",
                      lineHeight: 27,
                    }}
                  >
                    {linkedEvent?.name ||
                      item.header ||
                      (isGenericSlide ? "Own Your\nFinish Line." : item.alt)}
                  </Text>
                  {linkedEvent ? (
                    <>
                      <Text
                        variant="caption"
                        numberOfLines={1}
                        style={{
                          color: "#FFFFFF",
                          fontWeight: "800",
                          lineHeight: 18,
                        }}
                      >
                        {dates
                          .slice(0, 3)
                          .map((date) =>
                            date.toLocaleDateString("en-GB", {
                              day: "2-digit",
                              month: "short",
                              year: "numeric",
                            }),
                          )
                          .join("   •   ")}
                      </Text>
                      {ctaType === "LIVE" ? (
                        <View
                          style={{
                            alignSelf: "flex-start",
                            borderRadius: 10,
                            backgroundColor: "#DC2626",
                            paddingHorizontal: 12,
                            paddingVertical: 7,
                          }}
                        >
                          <Text
                            variant="caption"
                            style={{ color: "#FFFFFF", fontWeight: "900" }}
                          >
                            ● LIVE NOW
                          </Text>
                        </View>
                      ) : countdown &&
                        ctaType !== "RESULTS" &&
                        ctaType !== "DETAILS" ? (
                        <View style={{ flexDirection: "row", gap: 6 }}>
                          {[
                            ["Days", countdown.days],
                            ["Hrs", countdown.hours],
                            ["Min", countdown.minutes],
                            ["Sec", countdown.seconds],
                          ].map(([label, value]) => (
                            <View
                              key={String(label)}
                              style={{
                                flex: 1,
                                alignItems: "center",
                                paddingVertical: 7,
                                borderRadius: 10,
                                backgroundColor: "rgba(255,255,255,0.11)",
                              }}
                            >
                              <Text
                                variant="headline"
                                style={{ color: "#FFFFFF", fontWeight: "900" }}
                              >
                                {String(value).padStart(2, "0")}
                              </Text>
                              <Text
                                variant="caption"
                                style={{ color: "rgba(255,255,255,0.66)" }}
                              >
                                {label}
                              </Text>
                            </View>
                          ))}
                        </View>
                      ) : null}
                      <Text
                        variant="caption"
                        style={{ color: "#FB923C", fontWeight: "900" }}
                      >
                        {mobileEventCtaLabel(ctaType).toUpperCase()} →
                      </Text>
                    </>
                  ) : (
                    <>
                      <Text
                        variant="bodySmall"
                        style={{
                          color: "rgba(255,255,255,0.86)",
                          lineHeight: 19,
                        }}
                      >
                        {item.description ||
                          "The ultimate platform for India's endurance community. Track your progression, join a club, and conquer the most iconic courses."}
                      </Text>
                      {item.header || item.customUrl ? (
                        <Text
                          variant="caption"
                          style={{ color: "#FB923C", fontWeight: "900" }}
                        >
                          {(item.customLinkText || "Learn More").toUpperCase()}{" "}
                          →
                        </Text>
                      ) : (
                        <View>
                          <Pressable
                            accessibilityRole="button"
                            onPress={() => router.push("/dashboard")}
                            style={{
                              flex: 1,
                              alignItems: "center",
                              paddingVertical: 9,
                              borderRadius: 10,
                              backgroundColor: "#EA580C",
                            }}
                          >
                            <Text
                              variant="caption"
                              style={{ color: "#FFFFFF", fontWeight: "900" }}
                            >
                              MY ACCOUNT
                            </Text>
                          </Pressable>
                        </View>
                      )}
                    </>
                  )}
                </View>
              </View>
            );
          })}
        </ScrollView>
      ) : (
        <View
          style={{
            height: slideHeight,
            padding: 18,
            flexDirection: "row",
            alignItems: "center",
            gap: 14,
            backgroundColor: "#094B88",
          }}
        >
          <View
            style={{
              width: 78,
              height: 78,
              borderRadius: 22,
              backgroundColor: "#FFFFFF",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Image
              source={BERGMAN_LOGO}
              style={{ width: 68, height: 68 }}
              contentFit="contain"
            />
          </View>
          <View style={{ flex: 1, gap: 5 }}>
            <Text
              variant="display"
              style={{ color: "#FFFFFF", lineHeight: 40 }}
            >
              Bergman
            </Text>
            <Text
              variant="bodySmall"
              style={{ color: "rgba(255,255,255,0.86)", lineHeight: 18 }}
            >
              Find live tracking, upcoming races, official rankings, and past
              results.
            </Text>
          </View>
        </View>
      )}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open settings"
        onPress={onSettings}
        style={{
          position: "absolute",
          top: 12,
          right: 12,
          width: 42,
          height: 42,
          borderRadius: 21,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "rgba(3,10,20,0.72)",
          borderWidth: 1,
          borderColor: "rgba(255,255,255,0.28)",
        }}
      >
        <Icon name="settings" colorValue="#FFFFFF" size={20} />
      </Pressable>

      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          top: 12,
          left: 12,
          width: 42,
          height: 42,
          borderRadius: 12,
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
          backgroundColor: "#FFFFFF",
          borderWidth: 1,
          borderColor: "rgba(255,255,255,0.5)",
        }}
      >
        <Image
          source={BERGMAN_HEADER_MARK}
          style={{ width: 38, height: 38 }}
          contentFit="contain"
          accessibilityLabel="BERGMAN"
        />
      </View>

      {imageItems.length > 1 ? (
        <View
          style={{
            position: "absolute",
            top: slideHeight - 14,
            left: 0,
            right: 0,
            flexDirection: "row",
            justifyContent: "center",
            gap: 6,
          }}
          pointerEvents="box-none"
        >
          {imageItems.map((item, index) => (
            <Pressable
              key={item.id}
              accessibilityRole="button"
              accessibilityLabel={`Show banner ${index + 1}`}
              onPress={() => {
                setActiveIndex(index);
                carouselRef.current?.scrollTo({
                  x: index * slideWidth,
                  animated: true,
                });
              }}
              style={{
                width: index === activeIndex ? 20 : 7,
                height: 7,
                borderRadius: 999,
                backgroundColor:
                  index === activeIndex ? "#F28C28" : "rgba(255,255,255,0.62)",
              }}
            />
          ))}
        </View>
      ) : null}

      <View
        style={{
          flexDirection: "row",
          gap: 8,
          padding: 10,
          backgroundColor: "#07111F",
        }}
      >
        {(["Live", "Upcoming", "Past"] as const).map((label) => (
          <Pressable
            key={label}
            accessibilityRole="button"
            accessibilityLabel={`Jump to ${label.toLowerCase()} events`}
            onPress={() => onJump(label)}
            style={{
              flex: 1,
              alignItems: "center",
              paddingVertical: 8,
              borderRadius: 999,
              backgroundColor: "rgba(255,255,255,0.10)",
              borderWidth: 1,
              borderColor: "rgba(255,255,255,0.16)",
            }}
          >
            <Text
              variant="caption"
              style={{ color: "#FFFFFF", fontWeight: "900" }}
            >
              {label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function platformTextShadow(
  color: string,
  offsetY: number,
  blurRadius: number,
): TextStyle {
  if (Platform.OS === "web") {
    return {
      textShadow: `0 ${offsetY}px ${blurRadius}px ${color}`,
    } as unknown as TextStyle;
  }
  return {
    textShadowColor: color,
    textShadowOffset: { width: 0, height: offsetY },
    textShadowRadius: blurRadius,
  };
}

function byQuery(events: LiveEventItem[], query: string): LiveEventItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return events;
  return events.filter((event) => {
    const hay = [event.name, event.location, event.discipline, event.distances]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return hay.includes(q);
  });
}

function parseDate(value?: string): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getEventSortTime(event: LiveEventItem): number {
  const candidates = [event.startDate, event.endDate, event.dateLabel]
    .map((value) => parseDate(value ?? undefined))
    .filter((value): value is Date => Boolean(value));
  if (candidates.length > 0) {
    return Math.max(...candidates.map((date) => date.getTime()));
  }
  const yearMatch = String(event.dateLabel ?? event.name ?? "").match(
    /(20\d{2})/,
  );
  if (yearMatch) return Number(yearMatch[1]);
  return 0;
}

function formatEventDate(event: LiveEventItem): string {
  const scheduleDates = Array.isArray(event.disciplineSchedule)
    ? event.disciplineSchedule.flatMap((item) => {
        if (typeof item === "string") return [item];
        if (!item || typeof item !== "object") return [];
        const row = item as Record<string, unknown>;
        const value = row.date ?? row.eventDate ?? row.raceDate;
        return typeof value === "string" ? [value] : [];
      })
    : [];
  const ticketDateValues = (event.ticketDefinitions ?? []).flatMap((ticket) => {
    const value =
      ticket.eventDate ??
      ticket.raceDate ??
      ticket.ticketEventDate ??
      ticket.date;
    return typeof value === "string" ? [value] : [];
  });
  const ticketDates = [
    ...new Set(
      [...ticketDateValues, ...scheduleDates]
        .map((value) => parseDate(value))
        .filter((date): date is Date => Boolean(date))
        .map((date) => date.toISOString().slice(0, 10)),
    ),
  ]
    .map((value) => new Date(`${value}T12:00:00`))
    .sort((a, b) => a.getTime() - b.getTime());
  if (ticketDates.length > 1) {
    const first = ticketDates[0];
    const sameMonthAndYear = ticketDates.every(
      (date) =>
        date.getMonth() === first.getMonth() &&
        date.getFullYear() === first.getFullYear(),
    );
    if (sameMonthAndYear) {
      return `${ticketDates.map((date) => date.getDate()).join(" & ")} ${first.toLocaleDateString(undefined, { month: "short", year: "numeric" })}`;
    }
    return ticketDates
      .map((date) =>
        date.toLocaleDateString(undefined, {
          day: "numeric",
          month: "short",
          year: "numeric",
        }),
      )
      .join(" & ");
  }
  if (ticketDates.length === 1) {
    return ticketDates[0].toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  }
  if (event.dateLabel?.trim()) {
    return event.dateLabel.trim();
  }
  const start = parseDate(event.startDate);
  const end = parseDate(event.endDate);
  if (start && end && start.getTime() !== end.getTime()) {
    const sameYear = start.getFullYear() === end.getFullYear();
    const sameMonth = sameYear && start.getMonth() === end.getMonth();
    const startLabel = start.toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
    });
    const endLabel = end.toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
    return sameMonth && sameYear
      ? `${start.getDate()}–${end.getDate()} ${end.toLocaleDateString(undefined, { month: "short", year: "numeric" })}`
      : sameYear
        ? `${startLabel} – ${endLabel}`
        : `${start.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })} – ${endLabel}`;
  }
  if (start) {
    return start.toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  }
  return event.dateLabel || "TBD";
}

function EventList({
  events,
  emptyTitle,
  onOpen,
  onPrimary,
  emptyColor,
}: {
  events: LiveEventItem[];
  emptyTitle: string;
  onOpen: (eventId: string) => void;
  onPrimary: (event: LiveEventItem, type: MobileEventPrimaryCtaType) => void;
  emptyColor: string;
}) {
  if (events.length === 0) {
    return (
      <EmptyState
        title={emptyTitle}
        titleStyle={{
          textAlign: "center",
          color: emptyColor,
          ...platformTextShadow("rgba(0,0,0,0.24)", 1, 3),
        }}
      />
    );
  }
  return (
    <View style={{ gap: 12 }}>
      {events.map((event) => {
        const ctaType = getMobileEventPrimaryCta(event);
        return (
          <EventCard
            key={event.eventId || event.id}
            title={event.name}
            dateLabel={formatEventDate(event)}
            location={event.location}
            status={event.status}
            discipline={event.discipline}
            distances={event.distances}
            imageUri={event.imageUri}
            eventUrl={
              event.eventSlug || event.customSlug
                ? `https://bergmantri.com/races/${(event.eventSlug || event.customSlug || "").replace(/^\/+/, "")}`
                : undefined
            }
            primaryAction={{
              label: mobileEventCtaLabel(ctaType),
              disabled: ctaType === "SOLD_OUT",
              tone:
                ctaType === "SOLD_OUT"
                  ? "danger"
                  : ctaType === "LIVE"
                    ? "warning"
                    : ctaType === "RESULTS"
                      ? "success"
                      : "muted",
              onPress:
                ctaType === "SOLD_OUT"
                  ? undefined
                  : () => onPrimary(event, ctaType),
            }}
            detailsAction={
              ctaType === "DETAILS"
                ? undefined
                : {
                    label: "Details",
                    onPress: () => onOpen(event.eventId || event.id),
                  }
            }
            onPress={() => onOpen(event.eventId || event.id)}
          />
        );
      })}
    </View>
  );
}

function SectionTitle({ title, color }: { title: string; color: string }) {
  return (
    <Text
      variant="headline"
      style={{
        textAlign: "center",
        color,
        ...platformTextShadow("rgba(0,0,0,0.28)", 2, 4),
      }}
    >
      {title}
    </Text>
  );
}

export function HomeScreen() {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const router = useRouter();
  const { liveEvents, upcoming, past, isLoading, isError, refetch } =
    useHomeFeed();
  const [search, setSearch] = useState("");
  const scrollRef = useRef<ScrollView>(null);
  const [liveSectionY, setLiveSectionY] = useState(0);
  const [upcomingSectionY, setUpcomingSectionY] = useState(0);
  const [pastSectionY, setPastSectionY] = useState(0);
  const sliderQuery = useQuery({
    queryKey: queryKeys.homepage.slider,
    queryFn: ({ signal }) => repositories.events.getHomepageSlider(signal),
    staleTime: 5 * 60_000,
    gcTime: 24 * 60 * 60_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const heroEvents = useMemo(
    () => [...liveEvents, ...upcoming, ...past],
    [liveEvents, past, upcoming],
  );
  const filteredLive = useMemo(
    () => byQuery(liveEvents, search),
    [liveEvents, search],
  );
  const filteredUpcoming = useMemo(
    () => byQuery(upcoming, search),
    [upcoming, search],
  );
  const filteredPast = useMemo(
    () =>
      byQuery(past, search)
        .slice()
        .sort((a, b) => getEventSortTime(b) - getEventSortTime(a)),
    [past, search],
  );

  const openEvent = (eventId: string) => {
    const id = safeRouteEventId(eventId);
    if (!id) return;
    router.push({ pathname: "/event/[eventId]", params: { eventId: id } });
  };
  const openPrimary = (
    event: LiveEventItem,
    type: MobileEventPrimaryCtaType,
  ) => {
    const id = safeRouteEventId(event.eventId || event.id);
    if (!id) return;
    if (type === "LIVE")
      return router.push({
        pathname: "/event/[eventId]/track",
        params: { eventId: id },
      });
    if (type === "RESULTS")
      return router.push({
        pathname: "/event/[eventId]/results",
        params: { eventId: id },
      });
    if (type === "REGISTER") {
      const slug = event.eventSlug || event.customSlug;
      const url =
        event.registrationUrl ||
        (slug
          ? `https://bergmantri.com/event-form/${slug}`
          : `https://bergmantri.com/races/${id}`);
      void Linking.openURL(url);
      return;
    }
    openEvent(id);
  };

  const captureSectionY =
    (setter: Dispatch<SetStateAction<number>>) =>
    (event: LayoutChangeEvent) => {
      setter(event.nativeEvent.layout.y);
    };

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: theme.colors.background }}
      edges={["top", "left", "right"]}
    >
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={{
          padding: 16,
          gap: 18,
          paddingBottom: insets.bottom + 88,
        }}
        showsVerticalScrollIndicator={false}
      >
        <HomeHeroCarousel
          items={sliderQuery.data ?? []}
          events={heroEvents}
          onSettings={() => router.push("/settings")}
          onOpenEvent={openEvent}
          onPrimary={openPrimary}
          onJump={(section) => {
            const y =
              section === "Live"
                ? liveSectionY
                : section === "Upcoming"
                  ? upcomingSectionY
                  : pastSectionY;
            scrollRef.current?.scrollTo({
              y: Math.max(0, y - 12),
              animated: true,
            });
          }}
        />

        <MobileAnnouncementStrip screen="home" />
        <SearchBar
          value={search}
          onChangeText={setSearch}
          placeholder="Search events by name, location, or race type"
          dense
        />

        {isError ? (
          <Card style={{ gap: 10 }}>
            <Text variant="headline">Events unavailable</Text>
            <Text variant="bodySmall" color="textMuted">
              The backend did not return events right now.
            </Text>
            <Text
              variant="bodySmall"
              color="accent"
              onPress={() => void refetch()}
            >
              Reload events
            </Text>
          </Card>
        ) : isLoading ? (
          <View style={{ gap: 10 }}>
            <Skeleton height={220} radius={18} />
            <Skeleton height={220} radius={18} />
            <Skeleton height={220} radius={18} />
          </View>
        ) : (
          <>
            <View
              style={{ gap: 12 }}
              onLayout={captureSectionY(setLiveSectionY)}
            >
              <SectionTitle title="Live Events" color="#D63A3A" />
              <EventList
                events={filteredLive}
                emptyTitle="No live events right now"
                onOpen={openEvent}
                onPrimary={openPrimary}
                emptyColor="#D63A3A"
              />
            </View>

            <View
              style={{ gap: 12 }}
              onLayout={captureSectionY(setUpcomingSectionY)}
            >
              <SectionTitle title="Upcoming Events" color="#2E74D6" />
              <EventList
                events={filteredUpcoming}
                emptyTitle="No upcoming events"
                onOpen={openEvent}
                onPrimary={openPrimary}
                emptyColor="#2E74D6"
              />
            </View>

            <View
              style={{ gap: 12 }}
              onLayout={captureSectionY(setPastSectionY)}
            >
              <SectionTitle title="Past Events" color="#F28C28" />
              <EventList
                events={filteredPast}
                emptyTitle="No past events"
                onOpen={openEvent}
                onPrimary={openPrimary}
                emptyColor="#F28C28"
              />
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
