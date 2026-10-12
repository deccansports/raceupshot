import { Modal, Pressable, StyleSheet, View } from "react-native";

import { useTheme } from "@/core/theme";
import { Button, Icon, Text } from "@/shared/components";

import type { CourseMarkerView } from "../mappers";

type KmMarkerActionModalProps = {
  marker: CourseMarkerView | null;
  onClose: () => void;
  onNavigate: (marker: CourseMarkerView) => void;
};

function sportLabel(segment?: string): string {
  const normalized = String(segment ?? "").trim().toLowerCase();
  if (normalized === "swim" || normalized === "swimming") return "Swim";
  if (normalized === "bike" || normalized === "cycle" || normalized === "cycling") return "Bike";
  if (
    normalized === "run" ||
    normalized === "running" ||
    normalized === "run1" ||
    normalized === "run2"
  ) {
    return "Run";
  }
  return "Course";
}

function kmLabel(marker: CourseMarkerView): string {
  const value = marker.distanceKm;
  const distance = value == null
    ? marker.distanceLabel ?? marker.label
    : Number.isInteger(value)
      ? String(value)
      : value.toFixed(1).replace(/\.0$/, "");
  return `${sportLabel(marker.segment)} – KM ${distance.replace(/\s*km$/i, "")}`;
}

export function KmMarkerActionModal({
  marker,
  onClose,
  onNavigate,
}: KmMarkerActionModalProps) {
  const theme = useTheme();

  return (
    <Modal
      visible={marker != null}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.root}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close kilometre point"
          style={styles.backdrop}
          onPress={onClose}
        />
        <View
          accessibilityViewIsModal
          style={[
            styles.card,
            theme.shadows.modal,
            {
              backgroundColor: theme.colors.surfaceElevated,
              borderColor: theme.colors.border,
              borderRadius: theme.radius.large,
            },
          ]}
        >
          <View style={styles.headingRow}>
            <View
              style={[
                styles.icon,
                { backgroundColor: theme.colors.surfaceSunken },
              ]}
            >
              <Icon name="location" size={18} color="accent" />
            </View>
            <View style={styles.headingCopy}>
              <Text variant="caption" color="textMuted" style={styles.eyebrow}>
                KM POINT
              </Text>
              <Text variant="headline">
                {marker ? kmLabel(marker) : ""}
              </Text>
            </View>
          </View>
          <View style={styles.actions}>
            <View style={styles.action}>
              <Button label="Close" variant="ghost" onPress={onClose} fullWidth />
            </View>
            <View style={styles.action}>
              <Button
                label="Navigate"
                onPress={() => marker && onNavigate(marker)}
                fullWidth
              />
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  backdrop: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: "rgba(2, 6, 23, 0.52)",
  },
  card: {
    width: "100%",
    maxWidth: 360,
    padding: 18,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 18,
  },
  headingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  headingCopy: { flex: 1, gap: 3 },
  eyebrow: { fontWeight: "900", letterSpacing: 0.8 },
  icon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  actions: { flexDirection: "row", gap: 10 },
  action: { flex: 1 },
});
