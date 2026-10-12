import type { LiveParticipant } from "@/packages/contracts/src";

function durationSeconds(value: string | undefined): number | null {
  if (!value) return null;
  const normalized = value.trim();
  if (!normalized) return null;
  if (/^\d+(?:\.\d+)?$/.test(normalized)) {
    const seconds = Number(normalized);
    return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
  }
  const parts = normalized.split(":").map(Number);
  if (parts.length < 2 || parts.length > 3 || parts.some((part) => !Number.isFinite(part))) return null;
  const seconds = parts.reduce((total, part) => total * 60 + part, 0);
  return seconds > 0 ? seconds : null;
}

function runDistanceKm(category: string): number | null {
  const normalized = category.trim().toLowerCase();
  const explicit = normalized.match(/(?:run\s*)?(\d+(?:\.\d+)?)\s*k(?:m)?\b/);
  if (explicit) return Number(explicit[1]);
  // The named 102 km triathlon format is 2 km swim + 80 km bike + 20 km run.
  if (/\b102(?:\s*km)?\b.*\btriathlon\b|\btriathlon\b.*\b102(?:\s*km)?\b/.test(normalized)) return 20;
  if (/\bolympic\b|\bstandard(?:\s+distance)?\b/.test(normalized)) return 10;
  if (/\bsprint\b/.test(normalized)) return 5;
  if (/\b70[.]3\b|\bhalf(?:\s+iron(?:man)?)?\b/.test(normalized)) return 21.1;
  if (/\b140[.]6\b|\bfull(?:\s+iron(?:man)?)?\b/.test(normalized)) return 42.2;
  return null;
}

function formatMinutesPerKm(totalSeconds: number): string {
  const rounded = Math.round(totalSeconds);
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, "0")} /km`;
}

export function resultPace(participant: LiveParticipant): string {
  if (participant.pace?.trim()) return participant.pace.trim();
  const suppliedSplitPace = [...participant.splits].reverse().find((split) => split.paceOrSpeed?.trim())?.paceOrSpeed;
  if (suppliedSplitPace) return suppliedSplitPace;

  const runSplit = [...participant.splits].reverse().find((split) => /\brun\b/i.test(split.name));
  const distanceKm = runDistanceKm(participant.contestName);
  const seconds = durationSeconds(runSplit?.splitTime);
  return distanceKm && seconds ? formatMinutesPerKm(seconds / distanceKm) : "";
}
