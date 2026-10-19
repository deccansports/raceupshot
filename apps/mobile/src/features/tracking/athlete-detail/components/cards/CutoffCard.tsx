import { useTheme } from '@/core/theme';
import { SignalBadge, Text } from '@/shared/components';
import type { CutoffRow } from '@/core/types';

import { SectionCard, TileGrid } from './primitives';

/** Cumulative cutoff times + current cutoff status. */
export function CutoffCard({ cutoffs, status }: { cutoffs: CutoffRow[]; status?: string }) {
  const theme = useTheme();
  if (cutoffs.length === 0 && !status) return null;

  const withinCutoff = status ? /within/i.test(status) : true;

  return (
    <SectionCard title="Cutoffs" titleColor="statusUpcoming">
      {cutoffs.length > 0 ? (
        <TileGrid items={cutoffs.map((c) => ({ key: c.label, label: c.label, value: c.value }))} />
      ) : null}
      {status ? <SignalBadge kind={withinCutoff ? 'official' : 'delayed'} label={status} /> : null}
      {cutoffs.length === 0 && !status ? (
        <Text variant="caption" color="textMuted" style={{ marginTop: theme.spacing.xs }}>
          No cutoff configured
        </Text>
      ) : null}
    </SectionCard>
  );
}
