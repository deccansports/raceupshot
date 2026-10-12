import { useEffect, useMemo, useState } from "react";
import { View } from "react-native";

import { useTheme } from "@/core/theme";
import { Text } from "@/shared/components";
import type { StartTimingPresentation } from "@/features/tracking/timing/startTimingPresentation";

function parseStart(value?: string): number | null {
  const parsed = Date.parse(String(value ?? "").trim());
  return Number.isNaN(parsed) ? null : parsed;
}

function durationLabel(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const remainingSeconds = seconds % 60;
  const clock = [hours, minutes, remainingSeconds]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
  return days > 0 ? `${days}D ${clock}` : clock;
}

export function RaceStartCountdown({
  scheduledStart,
  startTiming,
}: {
  scheduledStart?: string;
  startTiming?: StartTimingPresentation;
}) {
  const theme = useTheme();
  const startAt = useMemo(
    () => startTiming?.gunStartAt ?? parseStart(scheduledStart),
    [scheduledStart, startTiming?.gunStartAt],
  );
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!startAt) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [startAt]);

  if (startTiming?.waitingForChipStart) {
    return (
      <View
        style={{
          paddingHorizontal: 12,
          paddingVertical: 11,
          gap: 5,
          borderRadius: theme.radius.medium,
          borderWidth: 1,
          borderColor: "rgba(46,116,214,0.44)",
          backgroundColor: "rgba(46,116,214,0.16)",
        }}
      >
        <Text
          variant="caption"
          style={{ color: "#AEB6C3", fontWeight: "900", letterSpacing: 0.5 }}
        >
          WAITING FOR CHIP START
        </Text>
        <Text
          variant="headline"
          style={{ color: "#FFFFFF", fontWeight: "900" }}
        >
          START · Waiting for timing mat
        </Text>
        {startTiming.gunStartLabel ? (
          <Text
            variant="bodySmall"
            style={{ color: "#D2D2D2", fontWeight: "800" }}
          >
            Gun Start · {startTiming.gunStartLabel}
          </Text>
        ) : null}
        <Text variant="caption" style={{ color: "#D2D2D2" }}>
          {startTiming.helperText ??
            "Your race time starts when you cross START."}
        </Text>
      </View>
    );
  }

  if (!startAt) return null;
  const remainingSeconds = Math.floor((startAt - now) / 1_000);
  const isFuture = remainingSeconds > 0;
  const officialTime = new Date(startAt).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <View
      style={{
        paddingHorizontal: 12,
        paddingVertical: 9,
        gap: 3,
        borderRadius: theme.radius.medium,
        borderWidth: 1,
        borderColor: isFuture
          ? "rgba(46,116,214,0.44)"
          : "rgba(255,255,255,0.14)",
        backgroundColor: isFuture
          ? "rgba(46,116,214,0.16)"
          : "rgba(255,255,255,0.07)",
      }}
    >
      <Text
        variant="caption"
        style={{ color: "#AEB6C3", fontWeight: "900", letterSpacing: 0.5 }}
      >
        {isFuture ? "STARTS IN" : "OFFICIAL START PASSED"}
      </Text>
      <Text variant="headline" style={{ color: "#FFFFFF", fontWeight: "900" }}>
        {durationLabel(Math.abs(remainingSeconds))}
      </Text>
      <Text variant="caption" style={{ color: "#D2D2D2" }}>
        {isFuture
          ? `Official start ${officialTime}`
          : `${officialTime} · awaiting the athlete’s first timing read`}
      </Text>
    </View>
  );
}
