import type { MetricRow } from '@/features/tracking/mappers';

import { SectionCard, TileGrid } from './primitives';

/** Distance breakdown across race legs from backend timing configuration. */
export function CourseOverviewCard({ items }: { items: MetricRow[] }) {
  if (items.length === 0) return null;
  return (
    <SectionCard title="Course Overview" titleColor="statusUpcoming">
      <TileGrid items={items.map((r) => ({ key: r.label, label: r.label, value: r.value }))} />
    </SectionCard>
  );
}
