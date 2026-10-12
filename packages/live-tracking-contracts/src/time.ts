import { shadowNormalizeTimestampUtc } from './shadow-timing-calculations';

const EXPLICIT_TIMEZONE = /(Z|[+-]\d{2}:?\d{2})$/i;
const NAIVE_TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/;

function validTimezone(value: unknown): string {
  const timezone = String(value ?? '').trim() || 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(0);
    return timezone;
  } catch {
    return 'UTC';
  }
}

function timezoneOffsetMillis(timestamp: number, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(timestamp);
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((row) => row.type === type)?.value || 0);
  const representedAsUtc = Date.UTC(part('year'), part('month') - 1, part('day'), part('hour'), part('minute'), part('second'));
  return representedAsUtc - Math.floor(timestamp / 1000) * 1000;
}

/** Parse an absolute provider timestamp; naive values are interpreted in the event/provider timezone. */
export function parseProviderTimestamp(value: unknown, providerTimezone = 'UTC'): Date | null {
  const numeric = typeof value === 'number'
    ? value
    : typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value.trim())
      ? Number(value.trim())
      : Number.NaN;
  if (Number.isFinite(numeric) && numeric > 0) {
    const timestamp = numeric > 10_000_000_000 ? numeric : numeric * 1000;
    const parsed = new Date(timestamp);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  if (EXPLICIT_TIMEZONE.test(raw)) {
    const parsed = Date.parse(raw);
    return Number.isFinite(parsed) ? new Date(parsed) : null;
  }
  const match = raw.match(NAIVE_TIMESTAMP);
  if (!match) {
    const parsed = Date.parse(raw);
    return Number.isFinite(parsed) ? new Date(parsed) : null;
  }
  const [, year, month, day, hour, minute, second = '0', milliseconds = '0'] = match;
  const naiveUtc = Date.UTC(
    Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second),
    Number(milliseconds.padEnd(3, '0')),
  );
  const timezone = validTimezone(providerTimezone);
  let resolved = naiveUtc - timezoneOffsetMillis(naiveUtc, timezone);
  // A second pass handles timestamps close to a daylight-saving boundary.
  resolved = naiveUtc - timezoneOffsetMillis(resolved, timezone);
  return new Date(resolved);
}

export function normalizeTimestampUtc(value: unknown, providerTimezone = 'UTC'): string | null {
  const authoritative = parseProviderTimestamp(value, providerTimezone)?.toISOString() ?? null;
  return shadowNormalizeTimestampUtc({ value, providerTimezone }, authoritative);
}

export function formatEventLocalTime(value: unknown, eventTimezone: string): string | null {
  const timestamp = parseProviderTimestamp(value, 'UTC');
  if (!timestamp) return null;
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: validTimezone(eventTimezone),
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23',
  }).format(timestamp);
}

export function formatViewerLocalTime(value: unknown): string | null {
  const timestamp = parseProviderTimestamp(value, 'UTC');
  if (!timestamp) return null;
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).format(timestamp);
}

export function formatDuration(milliseconds: number): string {
  const totalMilliseconds = Math.max(0, Number.isFinite(milliseconds) ? milliseconds : 0);
  const totalSeconds = Math.floor(totalMilliseconds / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const millis = Math.floor(totalMilliseconds % 1000);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}
