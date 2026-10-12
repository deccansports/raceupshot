const EVENT_TIME_ZONE = "Asia/Kolkata";

function dateParts(dateIso: string) {
  const date = new Date(dateIso);
  if (Number.isNaN(date.getTime())) return null;
  return Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: EVENT_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date).map((part) => [part.type, part.value]),
  );
}

export function eventEditorDate(dateIso: string): string {
  const parts = dateParts(dateIso);
  return parts ? `${parts.year}-${parts.month}-${parts.day}` : "";
}

export function eventEditorTime(displayTime: string | undefined, dateIso: string): string {
  const match = displayTime?.trim().match(/^(\d{1,2}):(\d{2})(?:\s*([ap])\.?m\.?)?$/i);
  if (match) {
    let hour = Number(match[1]);
    const minute = Number(match[2]);
    const meridiem = match[3]?.toLowerCase();
    if (meridiem === "a" && hour === 12) hour = 0;
    if (meridiem === "p" && hour < 12) hour += 12;
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
    }
  }

  const parts = dateParts(dateIso);
  return parts ? `${parts.hour}:${parts.minute}` : "";
}
