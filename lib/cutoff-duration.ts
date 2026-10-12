const MAX_CUTOFF_SECONDS = 7 * 24 * 60 * 60;

export function formatCutoffDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return "";
  const total = Math.round(seconds);
  return `${String(Math.floor(total / 3600)).padStart(2, "0")}:${String(Math.floor(total % 3600 / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export function parseCutoffDuration(value: string): number | null {
  const match = value.trim().match(/^(\d{1,3}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return null;
  const [, hours, minutes, seconds = "0"] = match;
  const total = Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds);
  return Number(minutes) < 60 && Number(seconds) < 60 && total <= MAX_CUTOFF_SECONDS ? total : null;
}
