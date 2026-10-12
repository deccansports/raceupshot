import { StyleSheet, View } from 'react-native';

import { useTheme } from '@/core/theme';

import { Text } from '../ui/Text';

export type LiveStatusPillProps = {
  connected: boolean;
  lastUpdatedLabel?: string;
  pollingLabel?: string;
};

/** Compact tracking-feed indicator: connection health, not athlete race status. */
export function LiveStatusPill({ connected, lastUpdatedLabel, pollingLabel }: LiveStatusPillProps) {
  const theme = useTheme();
  const color = connected ? theme.colors.success : theme.colors.textMuted;
  const label = connected ? 'TRACKING FEED CONNECTED' : 'RECONNECTING TRACKING FEED';

  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={`Live status: ${label}`}
      style={[
        styles.container,
        { backgroundColor: `${color}1F`, borderRadius: theme.radius.full },
      ]}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text variant="caption" style={{ color }}>
        {label}
      </Text>
      {lastUpdatedLabel ? (
        <Text variant="caption" color="textMuted">
          · {lastUpdatedLabel}
        </Text>
      ) : null}
      {pollingLabel ? (
        <Text variant="caption" color="textMuted">
          · Polling: {pollingLabel}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    alignSelf: 'flex-start',
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
