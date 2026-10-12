import { View } from 'react-native';

import { useTheme } from '@/core/theme';
import { SignalBadge, Text } from '@/shared/components';
import type { LivePositionView } from '@/features/tracking/mappers';

import { SectionCard, TileGrid } from './primitives';

/**
 * "Estimated Live Position" — a grid where each cell is tagged Official or
 * Estimated, plus a prediction footer (confidence / source / last updated).
 */
export function LivePositionCard({ live }: { live: LivePositionView }) {
  const theme = useTheme();

  const footer = [
    live.source ? `Source ${live.source}` : null,
    live.updatedAt ? `Updated ${live.updatedAt}` : null,
    live.cutoffStatus ?? null,
  ].filter(Boolean);

  return (
    <SectionCard title="Estimated Live Position" titleColor="accentSecondary">
      <Text variant="caption" color="textMuted">
        Estimated from the latest official timing point.
      </Text>
      <TileGrid
        items={live.items.map((item) => ({
          key: item.label,
          label: item.label,
          value: item.value,
          badge: <SignalBadge kind={item.signal} />,
        }))}
      />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
        {live.predictionConfidence ? (
          <SignalBadge kind={live.confidenceSignal} label={live.predictionConfidence} />
        ) : null}
        {footer.length > 0 ? (
          <Text variant="caption" color="textMuted" style={{ flexShrink: 1 }}>
            {footer.join(' · ')}
          </Text>
        ) : null}
      </View>
    </SectionCard>
  );
}
