/**
 * Framework-independent formatting helpers.
 *
 * Several helpers mirror the BERGMAN web app (`lib/utils.ts`,
 * `AthleteLiveModalPro`) — `formatSecondsToHMS`, `hmsToSeconds`,
 * `getCountryFlagEmoji`, `formatDistanceValue`, `formatCountdownFromSeconds` —
 * so the mobile app renders identical values from the same backend data.
 */

import countryFlags from './countryFlagsEmoji.json';

/** Formats a duration in seconds as H:MM:SS or MM:SS (compact, non-race UI). */
export function formatDuration(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  const mm = minutes.toString().padStart(2, '0');
  const ss = seconds.toString().padStart(2, '0');
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${minutes}:${ss}`;
}

/**
 * Race-time formatting identical to the web app's `formatSecondsToHMS`: always
 * HH:MM:SS, "--:--:--" for invalid/negative, "00:00:00" for 0.
 */
export function formatSecondsToHMS(seconds: number | null | undefined): string {
  if (
    seconds === undefined ||
    seconds === null ||
    Number.isNaN(seconds) ||
    seconds === Infinity ||
    seconds < 0
  )
    return '--:--:--';
  if (seconds === 0) return '00:00:00';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

/** Parses "H:MM:SS" / "MM:SS" / "SS" to seconds (Infinity for invalid) — mirrors the web. */
export function hmsToSeconds(timeString?: string | null): number {
  if (!timeString) return Infinity;
  const trimmed = timeString.trim();
  if (!trimmed || trimmed.toUpperCase() === 'N/A' || trimmed === '-') return Infinity;
  const parts = trimmed.split(':').map((p) => parseInt(p, 10));
  if (parts.some((n) => Number.isNaN(n))) return Infinity;
  let hours = 0;
  let minutes = 0;
  let seconds = 0;
  if (parts.length === 3) [hours, minutes, seconds] = parts;
  else if (parts.length === 2) [minutes, seconds] = parts;
  else if (parts.length === 1) [seconds] = parts;
  else return Infinity;
  if (hours < 0 || minutes < 0 || minutes >= 60 || seconds < 0 || seconds >= 60) return Infinity;
  return hours * 3600 + minutes * 60 + seconds;
}

/** Formats course distance values as kilometers, auto-converting meters when needed. */
export function formatDistanceKm(value: number | null | undefined): string | null {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  const km = numeric >= 1000 ? numeric / 1000 : numeric;
  const rounded = Math.round(km * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)} km`;
}

/** "1h 05m 30s" / "5m 30s"; returns null for invalid/negative input. */
export function formatCountdownFromSeconds(value: number | null | undefined): string | null {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  const total = Math.floor(numeric);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0)
    return `${hours}h ${String(minutes).padStart(2, '0')}m ${String(seconds).padStart(2, '0')}s`;
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}

type FlagEntry = { name: string; emoji: string };
const FLAGS = countryFlags as Record<string, FlagEntry>;

const COUNTRY_ALIASES: Readonly<Record<string, string>> = {
  IND: 'IN',
  INDIAN: 'IN',
  USA: 'US',
  'UNITED STATES OF AMERICA': 'US',
  UK: 'GB',
  'GREAT BRITAIN': 'GB',
  UAE: 'AE',
  KSA: 'SA',
};

export function getCountryCode(countryNameOrCode?: string | null): string {
  const raw = String(countryNameOrCode ?? '').trim();
  if (!raw) return '';
  const upper = raw.toUpperCase();
  if (/^[A-Z]{2}$/.test(upper)) return upper;
  if (COUNTRY_ALIASES[upper]) return COUNTRY_ALIASES[upper];
  const normalized = raw.toLowerCase();
  for (const code in FLAGS) {
    if (FLAGS[code].name.toLowerCase() === normalized) return code;
  }
  return '';
}

export function getCountryDisplayName(countryNameOrCode?: string | null): string {
  if (!countryNameOrCode) return '';
  const raw = String(countryNameOrCode).trim();
  if (!raw) return '';
  const code = getCountryCode(raw);
  if (code && FLAGS[code]) return FLAGS[code].name;
  return raw;
}

/**
 * Country flag emoji from a stored ISO2 code or a recognized legacy country
 * name/alias. The flag itself is generated from Unicode regional indicators.
 */
export function getCountryFlagEmoji(countryName?: string | null): string {
  const code = getCountryCode(countryName);
  if (!code) return '';
  return [...code]
    .map((character) => String.fromCodePoint(127397 + character.charCodeAt(0)))
    .join('');
}
