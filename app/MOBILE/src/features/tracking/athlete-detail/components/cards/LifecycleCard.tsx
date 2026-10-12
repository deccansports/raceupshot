import { View } from 'react-native';

import { useTheme } from '@/core/theme';
import { SignalBadge, Text } from '@/shared/components';
import type { LifecycleView } from '@/features/tracking/mappers';

import { SectionCard } from './primitives';

/** Race lifecycle + prediction health (mirrors the web "Race Status" card). */
export function LifecycleCard({ lifecycle }: { lifecycle: LifecycleView }) {
  const theme = useTheme();
  if (!lifecycle.label && !lifecycle.predictionStatus && !lifecycle.frozen) return null;

  return (
    <SectionCard title="Race Status" titleColor="statusFinished">
      {lifecycle.label ? (
        <Text variant="body" color="textPrimary">
          {lifecycle.label}
        </Text>
      ) : null}

      {lifecycle.predictionStatus ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
          <Text variant="caption" color="textMuted">
            Prediction
          </Text>
          <SignalBadge
            kind={lifecycle.frozen ? 'delayed' : 'estimated'}
            label={lifecycle.predictionStatus}
          />
        </View>
      ) : null}

      {lifecycle.frozen && lifecycle.frozenReason ? (
        <Text variant="caption" color="warning">
          {lifecycle.frozenReason}
        </Text>
      ) : null}
    </SectionCard>
  );
}
