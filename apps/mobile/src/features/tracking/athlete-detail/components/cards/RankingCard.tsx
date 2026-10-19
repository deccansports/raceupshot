import { View } from 'react-native';

import { useTheme } from '@/core/theme';
import { Stat } from '@/shared/components';
import type { MetricRow } from '@/features/tracking/mappers';

import { SectionCard } from './primitives';

/** Overall / gender / category / club rankings. */
export function RankingCard({ rankings }: { rankings: MetricRow[] }) {
  const theme = useTheme();
  if (rankings.length === 0) return null;

  return (
    <SectionCard title="Rankings" titleColor="accent">
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.xl }}>
        {rankings.map((r) => (
          <Stat key={r.label} value={r.value} label={r.label} color="accent" />
        ))}
      </View>
    </SectionCard>
  );
}
