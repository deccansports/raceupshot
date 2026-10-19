type Stamp = { id: string; eventId: string; volunteerId: string; action: string; reversesOperationId?: string | null };

/** Rows must be newest-first in server recording order, not device clock order. */
export function latestResettableTimingId(rows: readonly Stamp[], eventId: string, volunteerId: string): string | null {
  const latest = rows.find(row => row.eventId === eventId && row.volunteerId === volunteerId && row.action === "MANUAL_TIMING_CAPTURED");
  if (!latest) return null;
  // Do not reopen an older stamp when the newest one has been reset.
  if (rows.some(row => row.eventId === eventId && row.action === "MANUAL_TIMING_RESET" && row.reversesOperationId === latest.id)) return null;
  return latest.id;
}
