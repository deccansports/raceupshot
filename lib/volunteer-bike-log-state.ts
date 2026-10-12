export interface BikeOperationAuditRow {
  id: string;
  eventId: string;
  participantUid: string;
  action: string;
  capturedAt: string;
}

function participantKey(row: BikeOperationAuditRow): string {
  return `${row.eventId}\u0000${row.participantUid}`;
}

function timestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

/**
 * Returns historical bike-in/out records covered by the participant's latest
 * administrator reset. A bike action recorded after that reset remains active.
 */
export function bikeOperationResetIds(rows: BikeOperationAuditRow[]): Set<string> {
  const latestResetByParticipant = new Map<string, number>();

  for (const row of rows) {
    if (row.action !== "ADMIN_BIKE_CHECK_IN_RESET") continue;
    const key = participantKey(row);
    latestResetByParticipant.set(key, Math.max(latestResetByParticipant.get(key) ?? Number.NEGATIVE_INFINITY, timestamp(row.capturedAt)));
  }

  return new Set(rows
    .filter((row) => {
      if (row.action !== "BIKE_IN" && row.action !== "BIKE_OUT") return false;
      const resetAt = latestResetByParticipant.get(participantKey(row));
      return resetAt !== undefined && resetAt >= timestamp(row.capturedAt);
    })
    .map((row) => row.id));
}
