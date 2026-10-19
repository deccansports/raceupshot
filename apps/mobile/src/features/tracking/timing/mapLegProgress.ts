import type { AthleteRaceTiming } from './raceSections';

export function mapSport(value: unknown): string {
  const key = String(value ?? '').toLowerCase().replace(/[_-]/g, ' ');
  if (/bike|cycl/.test(key)) return 'bike';
  if (/swim/.test(key)) return 'swim';
  if (/run/.test(key)) return /run\s*1/.test(key) ? 'run1' : /run\s*2/.test(key) ? 'run2' : 'run';
  return '';
}

/** Locate a sport using accepted timing boundaries, never predicted distance. */
export function mapLegProgress(timing: AthleteRaceTiming | undefined, fallbackLeg?: string) {
  const sections = timing?.sections ?? [];
  const active = [...sections].reverse().find(section => section.status === 'in_progress');
  const section = active?.type === 'leg' ? active : active
    ? [...sections.slice(0, sections.indexOf(active))].reverse().find(item => item.type === 'leg')
    : [...sections].reverse().find(item => item.type === 'leg' && item.rows.some(row => row.status === 'valid'));
  const sport = mapSport(section?.legType ?? section?.title) || mapSport(fallbackLeg);
  const offsets = (section?.rows ?? []).flatMap(row =>
    row.cumulativeDistanceKm != null && row.distanceInLegKm != null
      ? [row.cumulativeDistanceKm - row.distanceInLegKm] : []);
  const distances = (section?.rows ?? []).flatMap(row => row.distanceInLegKm != null ? [row.distanceInLegKm] : []);
  const accepted = (section?.rows ?? []).filter(row => row.status === 'valid');
  return {
    sport,
    startKm: offsets.length ? Math.max(0, offsets[0]) : undefined,
    totalKm: distances.length ? Math.max(...distances) : undefined,
    officialKm: Math.max(0, ...accepted.map(row => row.distanceInLegKm ?? 0)),
    atEnd: active?.type === 'transition' || section?.status === 'completed',
  };
}
