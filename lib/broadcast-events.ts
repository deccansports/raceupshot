interface BroadcastEventRow {
  dateIso: string;
  status: string;
}

function startOfToday(now: Date): number {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  return today.valueOf();
}

export function orderBroadcastEvents<T extends BroadcastEventRow>(events: T[], now = new Date()): T[] {
  const today = startOfToday(now);
  const rank = (event: T) => {
    if (event.status.toLowerCase() === "live") return 0;
    const timestamp = new Date(event.dateIso).valueOf();
    if (!Number.isFinite(timestamp)) return 2;
    return timestamp >= today ? 1 : 3;
  };

  return [...events].sort((left, right) => {
    const rankDifference = rank(left) - rank(right);
    if (rankDifference) return rankDifference;
    const leftDate = new Date(left.dateIso).valueOf();
    const rightDate = new Date(right.dateIso).valueOf();
    if (!Number.isFinite(leftDate) && !Number.isFinite(rightDate)) return 0;
    if (!Number.isFinite(leftDate)) return 1;
    if (!Number.isFinite(rightDate)) return -1;
    return rank(left) === 3 ? rightDate - leftDate : leftDate - rightDate;
  });
}
