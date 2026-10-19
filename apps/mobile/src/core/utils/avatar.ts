/**
 * Deterministic athlete avatar helpers (framework-independent).
 *
 * Priority for an athlete image is decided by the caller: profilePhotoUrl →
 * stored image → generated initials avatar. These helpers cover the initials
 * fallback: same athlete always gets the same initials + color.
 */

/**
 * Uppercase initials from a name — mirrors the BERGMAN web app's `getInitials`
 * (`lib/utils.ts`) exactly: first+last for multi-word names, first two letters
 * for a single word, and 'A' as the fallback.
 */
export function getInitials(name?: string | null): string {
  if (!name) return 'A';
  const names = name.trim().split(' ');
  if (names.length > 1) return `${names[0][0]}${names[names.length - 1][0]}`.toUpperCase();
  return name.trim().substring(0, 2).toUpperCase();
}

/** Fixed, high-contrast palette (blue/green/orange/purple/red/teal/gray). */
export const AVATAR_PALETTE = [
  '#2E74D6',
  '#1E9E6A',
  '#E07B2E',
  '#7C4DD1',
  '#E1122A',
  '#0E9AA7',
  '#6B7280',
] as const;

/** Stable string hash (djb2) so a seed always maps to the same color. */
function hashSeed(seed: string): number {
  let hash = 5381;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 33) ^ seed.charCodeAt(i);
  }
  return Math.abs(hash);
}

/** Deterministic avatar background color for an athlete id/name seed. */
export function avatarColor(seed: string): string {
  if (!seed) return AVATAR_PALETTE[AVATAR_PALETTE.length - 1];
  return AVATAR_PALETTE[hashSeed(seed) % AVATAR_PALETTE.length];
}
