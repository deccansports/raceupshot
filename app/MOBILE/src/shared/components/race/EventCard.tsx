import { useState } from "react";
import { Linking, Pressable, View, useWindowDimensions } from "react-native";
import { Image } from "expo-image";

import { useTheme, type SemanticColors } from "@/core/theme";

import { Card } from "../ui/Card";
import { Icon } from "../ui/Icon";
import { Text } from "../ui/Text";
import { RaceStatusBadge } from "./RaceStatusBadge";
import { type RaceStatus } from "./RaceStatus";

const FALLBACK_EVENT_IMAGE = require("../../../../assets/images/event-placeholder.jpg");

export type RegistrationTone = "success" | "warning" | "danger" | "muted";

export type EventCardProps = {
  title: string;
  dateLabel: string;
  location?: string;
  status: RaceStatus;
  /** Race type, e.g. "Triathlon". */
  discipline?: string;
  /** Distances/legs, e.g. "1.5K Swim · 40K Bike · 10K Run". */
  distances?: string;
  registration?: { label: string; tone: RegistrationTone };
  imageUri?: string;
  eventUrl?: string;
  primaryAction?: {
    label: string;
    disabled?: boolean;
    tone?: RegistrationTone;
    onPress?: () => void;
  };
  detailsAction?: { label?: string; onPress: () => void };
  onPress?: () => void;
};

const TONE_COLOR: Record<RegistrationTone, keyof SemanticColors> = {
  success: "success",
  warning: "warning",
  danger: "danger",
  muted: "textMuted",
};

export function EventCard({
  title,
  dateLabel,
  location,
  status,
  discipline,
  distances,
  registration,
  imageUri,
  eventUrl,
  primaryAction,
  detailsAction,
  onPress,
}: EventCardProps) {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const isTablet = width >= 768;
  const regColor = registration
    ? theme.colors[TONE_COLOR[registration.tone]]
    : undefined;
  const [failedImageUri, setFailedImageUri] = useState<string | undefined>();
  const hasUploadedImage = Boolean(imageUri && failedImageUri !== imageUri);
  const imageSource = hasUploadedImage
    ? { uri: imageUri }
    : FALLBACK_EVENT_IMAGE;
  const cardHeight = isTablet
    ? Math.min(360, Math.max(280, width * 0.28))
    : 176;

  return (
    <Card
      padded={false}
      style={{ overflow: "hidden", backgroundColor: theme.colors.surface }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open ${title}`}
        onPress={onPress}
        style={{ height: cardHeight }}
      >
        {hasUploadedImage ? (
          <Image
            source={imageSource}
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              opacity: 0.55,
            }}
            contentFit="cover"
            blurRadius={18}
            cachePolicy="memory-disk"
          />
        ) : null}
        <Image
          source={imageSource}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
          }}
          // Keep the complete event artwork visible on wide tablet cards. The
          // blurred cover layer behind it fills any letterbox space.
          contentFit={isTablet && hasUploadedImage ? "contain" : "cover"}
          contentPosition="center"
          cachePolicy="memory-disk"
          recyclingKey={imageUri ?? "event-placeholder"}
          onError={() => {
            if (hasUploadedImage) setFailedImageUri(imageUri);
          }}
        />
        <View
          style={{
            position: "absolute",
            inset: 0,
            backgroundColor: "rgba(11,13,18,0.28)",
          }}
        />
        <View style={{ flex: 1, justifyContent: "space-between" }}>
          <View
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "flex-start",
              padding: 14,
            }}
          >
            <RaceStatusBadge status={status} onImage />
            {registration ? (
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 6,
                  paddingHorizontal: 10,
                  paddingVertical: 5,
                  borderRadius: theme.radius.full,
                  backgroundColor: "rgba(242,140,40,0.18)",
                }}
              >
                <View
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: 3,
                    backgroundColor: regColor ?? theme.colors.warning,
                  }}
                />
                <Text
                  variant="caption"
                  style={{ color: theme.colors.textInverse }}
                >
                  {registration.label.toUpperCase()}
                </Text>
              </View>
            ) : null}
          </View>

          <View style={{ padding: 14, gap: 6 }}>
            <Text
              variant="headline"
              numberOfLines={2}
              ellipsizeMode="tail"
              style={{
                color: theme.colors.textInverse,
                fontSize: 20,
                lineHeight: 24,
                fontWeight: "800",
              }}
            >
              {title}
            </Text>

            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
                flexWrap: "wrap",
              }}
            >
              <Icon name="calendar" size={16} color="textInverse" />
              <Text
                variant="caption"
                style={{ color: theme.colors.textInverse }}
              >
                {dateLabel}
              </Text>
              {location ? (
                <>
                  <Text
                    variant="caption"
                    style={{ color: theme.colors.textInverse }}
                  >
                    ·
                  </Text>
                  <Text
                    variant="caption"
                    style={{ color: theme.colors.textInverse }}
                    numberOfLines={1}
                  >
                    {location}
                  </Text>
                </>
              ) : null}
            </View>

            {discipline || distances ? (
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 8,
                  flexWrap: "wrap",
                }}
              >
                {discipline ? (
                  <View
                    style={{
                      backgroundColor: "rgba(11,94,168,0.88)",
                      paddingHorizontal: 10,
                      paddingVertical: 5,
                      borderRadius: theme.radius.full,
                    }}
                  >
                    <Text
                      variant="caption"
                      style={{ color: theme.colors.textInverse }}
                    >
                      {discipline.toUpperCase()}
                    </Text>
                  </View>
                ) : null}
                {distances ? (
                  <Text
                    variant="caption"
                    style={{ color: "rgba(255,255,255,0.9)" }}
                  >
                    {distances}
                  </Text>
                ) : null}
              </View>
            ) : null}
          </View>
        </View>
      </Pressable>
      {primaryAction || eventUrl || detailsAction ? (
        <View
          style={{
            flexDirection: "row",
            borderTopWidth: 1,
            borderTopColor: theme.colors.border,
          }}
        >
          {primaryAction || eventUrl ? (
            <Pressable
              accessibilityRole={primaryAction?.disabled ? "text" : "button"}
              accessibilityLabel={primaryAction?.label ?? `Visit ${eventUrl}`}
              disabled={primaryAction?.disabled}
              onPress={
                primaryAction?.onPress ??
                (eventUrl ? () => void Linking.openURL(eventUrl) : undefined)
              }
              style={{
                flex: 1,
                minHeight: 46,
                paddingHorizontal: theme.spacing.base,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                backgroundColor: primaryAction?.disabled
                  ? theme.colors.surfaceSunken
                  : theme.colors.surface,
              }}
            >
              <Text
                variant="label"
                color={primaryAction?.disabled ? "danger" : "accent"}
                numberOfLines={1}
              >
                {primaryAction?.label ?? "Know More"}
              </Text>
              {!primaryAction?.disabled ? (
                <Icon name="arrowRight" size={16} color="accent" />
              ) : null}
            </Pressable>
          ) : null}
          {detailsAction ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={detailsAction.label ?? "Details"}
              onPress={detailsAction.onPress}
              style={{
                flex: 1,
                minHeight: 46,
                paddingHorizontal: theme.spacing.base,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                borderLeftWidth: primaryAction || eventUrl ? 1 : 0,
                borderLeftColor: theme.colors.border,
                backgroundColor: theme.colors.surface,
              }}
            >
              <Text variant="label" color="textPrimary">
                {detailsAction.label ?? "Details"}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </Card>
  );
}
