function finitePositive(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function parseFinishDurationSeconds(value: unknown): number | null {
  const text = String(value ?? "").trim();
  if (!text) return null;
  if (/^\d+(?:\.\d+)?$/.test(text)) return finitePositive(text);

  const parts = text.split(":").map(Number);
  if (parts.length < 2 || parts.length > 3 || parts.some((part) => !Number.isFinite(part))) {
    return null;
  }
  const [hours, minutes, seconds] = parts.length === 3
    ? parts
    : [0, parts[0], parts[1]];
  if (minutes < 0 || minutes >= 60 || seconds < 0 || seconds >= 60) return null;
  return finitePositive(hours * 3600 + minutes * 60 + seconds);
}

function paceClock(seconds: number): string {
  const rounded = Math.max(0, Math.round(seconds));
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const secondsPart = rounded % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(secondsPart).padStart(2, "0")}`
    : `${minutes}:${String(secondsPart).padStart(2, "0")}`;
}

export function deriveOverallFinishMetric(input: {
  durationSeconds: unknown;
  distanceKm: unknown;
  raceCategory?: unknown;
}): string | null {
  const durationSeconds = finitePositive(input.durationSeconds);
  const distanceKm = finitePositive(input.distanceKm);
  if (durationSeconds == null || distanceKm == null) return null;

  const category = String(input.raceCategory ?? "").trim().toLowerCase();
  const isSwimOnly = /swimathon|open water|swimming|\bswim\b/.test(category)
    && !/triathlon|aquathlon/.test(category);
  const isBikeOnly = /cycling|cycle race|bike race|\bbike\b/.test(category)
    && !/triathlon|duathlon/.test(category);

  if (isSwimOnly) {
    return `${paceClock(durationSeconds / (distanceKm * 10))} /100m`;
  }
  if (isBikeOnly) {
    return `${(distanceKm / (durationSeconds / 3600)).toFixed(2)} km/h`;
  }
  return `${paceClock(durationSeconds / distanceKm)} /km`;
}
