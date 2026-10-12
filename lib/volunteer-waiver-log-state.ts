export interface WaiverOperationAuditRow {
  id: string;
  eventId: string;
  participantUid: string;
  action: string;
  capturedAt: string;
}

function participantKey(row: WaiverOperationAuditRow): string {
  return `${row.eventId}\u0000${row.participantUid}`;
}

function timestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

/** Return waiver-verification rows covered by a later reset/legacy recall. */
export function waiverOperationResetIds(rows: WaiverOperationAuditRow[]): Set<string> {
  const latestResetByParticipant = new Map<string, number>();
  for (const row of rows) {
    if (row.action !== "ADMIN_WAIVER_CHECK_IN_RESET" && row.action !== "CHECK_IN_REVERSE") continue;
    const key = participantKey(row);
    latestResetByParticipant.set(key, Math.max(latestResetByParticipant.get(key) ?? Number.NEGATIVE_INFINITY, timestamp(row.capturedAt)));
  }
  return new Set(rows
    .filter((row) => row.action === "WAIVER_VERIFY"
      && (latestResetByParticipant.get(participantKey(row)) ?? Number.NEGATIVE_INFINITY) >= timestamp(row.capturedAt))
    .map((row) => row.id));
}
