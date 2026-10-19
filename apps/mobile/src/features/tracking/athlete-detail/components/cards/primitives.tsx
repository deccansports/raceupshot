import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { useTheme, type SemanticColors } from '@/core/theme';
import { Card, Text } from '@/shared/components';

/** A titled Card. Title color mirrors the web modal's colored section headers. */
export function SectionCard({
  title,
  titleColor = 'accent',
  children,
  style,
}: {
  title?: string;
  titleColor?: keyof SemanticColors;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  return (
    <Card style={[{ gap: theme.spacing.sm }, style]}>
      {title ? (
        <Text variant="label" color={titleColor}>
          {title.toUpperCase()}
        </Text>
      ) : null}
      {children}
    </Card>
  );
}

/** A single bordered metric tile: muted label (+ optional badge) over a value. */
export function MetricTile({
  label,
  value,
  badge,
}: {
  label: string;
  value: string;
  badge?: ReactNode;
}) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.tile,
        {
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.surfaceSunken,
          borderRadius: theme.radius.medium,
          padding: theme.spacing.sm,
        },
      ]}>
      <View style={styles.tileHead}>
        <Text variant="caption" color="textMuted" style={styles.tileLabel}>
          {label}
        </Text>
        {badge ?? null}
      </View>
      <Text variant="body" color="textPrimary" style={styles.tileValue}>
        {value}
      </Text>
    </View>
  );
}

/** Wrapping grid of metric tiles; tiles grow to fill their row. */
export function TileGrid({
  items,
}: {
  items: { key: string; label: string; value: string; badge?: ReactNode }[];
}) {
  const theme = useTheme();
  return (
    <View style={[styles.grid, { gap: theme.spacing.sm }]}>
      {items.map((item) => (
        <MetricTile key={item.key} label={item.label} value={item.value} badge={item.badge} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  tile: {
    borderWidth: StyleSheet.hairlineWidth,
    flexGrow: 1,
    flexBasis: '30%',
    minWidth: 104,
    gap: 4,
  },
  tileHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 6 },
  tileLabel: { flexShrink: 1 },
  tileValue: { fontWeight: '700' },
});
