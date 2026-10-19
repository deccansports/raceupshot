export type CutoffFilter = 'ALL' | 'MONITOR' | 'FINISHED' | 'APPROACHING' | 'OUT' | 'DNF' | 'SAFE';

export function matchesCutoffFilter(athlete: { started: boolean; finished: boolean; status: string; cutoff: { status: string } }, filter: CutoffFilter): boolean {
  if (filter === 'ALL') return true;
  if (filter === 'FINISHED') return athlete.finished;
  if (athlete.finished) return false;
  if (filter === 'DNF') return athlete.status === 'DNF' || athlete.cutoff.status === 'DNF';
  if (!athlete.started) return false;
  if (filter === 'APPROACHING') return ['WATCH', 'DANGER'].includes(athlete.cutoff.status);
  if (filter === 'OUT') return athlete.cutoff.status === 'OUT OF CUTOFF';
  if (filter === 'SAFE') return athlete.cutoff.status === 'SAFE';
  return athlete.cutoff.status !== 'NO CUTOFF' || athlete.status === 'DNF';
}
