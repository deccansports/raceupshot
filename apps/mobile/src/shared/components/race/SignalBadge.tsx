import { StyleSheet, View } from 'react-native';

import { useTheme, type SemanticColors } from '@/core/theme';

import { Text } from '../ui/Text';

export type SignalKind = 'official' | 'estimated' | 'waiting' | 'delayed';

export type SignalBadgeProps = {
  kind: SignalKind;
  /** Defaults to a title-cased version of `kind`. */
  label?: string;
};

/**
 * Data-provenance pill used across the Athlete Detail screen. Mirrors the web
 * app's `getSignalBadgeClass` semantics:
 *   official → confirmed timing read · estimated → predicted between reads
 *   delayed → stale/frozen prediction · waiting → no data yet
 */
const kindMeta: Record<SignalKind, { color: keyof SemanticColors; label: string }> = {
  official: { color: 'success', label: 'Official' },
  estimated: { color: 'accentSecondary', label: 'Estimated' },
  delayed: { color: 'warning', label: 'Delayed' },
  waiting: { color: 'textMuted', label: 'Waiting' },
};

export function SignalBadge({ kind, label }: SignalBadgeProps) {
  const theme = useTheme();
  const meta = kindMeta[kind];
  const color = theme.colors[meta.color];

  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={`${label ?? meta.label} signal`}
      style={[
        styles.container,
        {
          backgroundColor: `${color}22`,
          borderColor: `${color}55`,
          borderRadius: theme.radius.full,
        },
      ]}>
      <Text variant="caption" style={{ color, fontSize: 10 }}>
        {(label ?? meta.label).toUpperCase()}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 8,
    paddingVertical: 2,
    alignSelf: 'flex-start',
  },
});
