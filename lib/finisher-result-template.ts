export const DEFAULT_RESULTS_CAMPAIGN = 'results';
export type ResultLeg = { name: string; time: number };
type TimedLeg = { id: string; name: string; type: string; order: number };
type ConfiguredSplit = { id: string; legId: string; order: number };
type RecordedSplit = { splitId: string; officialTimeMs?: number; sectionTimeMs?: number };
export function resultDuration(seconds: number): string {
  const total = Math.round(seconds);
  return [Math.floor(total / 3600), Math.floor(total % 3600 / 60), total % 60].map(n => String(n).padStart(2, '0')).join(':');
}
export function validFinishTime(value: string): boolean {
  if (!/^\d+:\d{2}:\d{2}(?:\.\d+)?$/.test(value)) return false;
  const [h, m, s] = value.split(':').map(Number);
  return m < 60 && s < 60 && h * 3600 + m * 60 + s > 0;
}
export function resultRaceBreakdown(legs: ResultLeg[] = []): string {
  // Leg durations only; never substitute cumulative checkpoint times.
  return legs.filter(leg => typeof leg?.name === 'string' && leg.name.trim() && Number.isFinite(leg.time) && leg.time > 0)
    .map(leg => `${leg.name.trim()}: ${resultDuration(leg.time)}`).join(' • ') || 'Leg splits are not available.';
}
export function resultFinishTime(value: string): string {
  return /^\d+:\d{2}:\d{2}(?:\.\d+)?$/.test(value) ? value.replace(/\.\d+$/, '') : value;
}
export function resultLegTimes(legs: TimedLeg[], splits: ConfiguredSplit[], recorded: RecordedSplit[]): ResultLeg[] {
  const orderedLegs = [...legs].sort((a, b) => a.order - b.order);
  const isTriathlon = ['SWIM', 'BIKE', 'RUN'].every(type => orderedLegs.some(leg => leg.type === type));
  const recordedById = new Map(recorded.map(split => [split.splitId, split]));
  const boundaries = orderedLegs.map(leg => {
    const actual = splits.filter(split => split.legId === leg.id).sort((a, b) => a.order - b.order)
      .map(split => recordedById.get(split.id));
    const valid = actual.length > 0 && actual.every(split => split && Number.isFinite(split.sectionTimeMs) && split.sectionTimeMs! >= 0);
    const first = actual[0]?.officialTimeMs;
    const last = actual.at(-1)?.officialTimeMs;
    const boundaryDuration = actual.length > 1 && Number.isFinite(first) && Number.isFinite(last) && last! >= first!
      ? (last! - first!) / 1000 : null;
    return { leg, first, last, duration: isTriathlon && boundaryDuration !== null
      ? boundaryDuration : valid ? actual.reduce((sum, split) => sum + split!.sectionTimeMs!, 0) / 1000 : null };
  });
  const result: ResultLeg[] = [];
  for (let index = 0; index < boundaries.length; index++) {
    const current = boundaries[index];
    if (current.duration !== null) result.push({ name: current.leg.name, time: current.duration });
    if (!isTriathlon) continue;
    const next = boundaries[index + 1];
    const transition = current.leg.type === 'SWIM' && next?.leg.type === 'BIKE' ? 'T1'
      : current.leg.type === 'BIKE' && next?.leg.type === 'RUN' ? 'T2' : null;
    if (transition && Number.isFinite(current.last) && Number.isFinite(next.first) && next.first! > current.last!) {
      result.push({ name: transition, time: (next.first! - current.last!) / 1000 });
    }
  }
  return result;
}
export function resultWhatsAppParameters(member: { name: string; category: string; bib: string; finishTime: string; legTimes?: ResultLeg[] }, eventName: string): string[] {
  return [member.name, member.category, eventName, member.category, member.bib, resultFinishTime(member.finishTime), resultRaceBreakdown(member.legTimes)];
}
export function resultPassageIdentity(bib: string, category: string): string | null {
  if (!bib.trim() || !category.trim()) return null;
  return JSON.stringify([category.trim().toLowerCase(), bib.trim().toLowerCase()]);
}
