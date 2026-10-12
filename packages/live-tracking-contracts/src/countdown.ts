export type CountdownParts = {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  isPast: boolean;
  isStartingSoon: boolean;
  valid: boolean;
};

const EMPTY: CountdownParts = {
  days: 0,
  hours: 0,
  minutes: 0,
  seconds: 0,
  isPast: true,
  isStartingSoon: false,
  valid: false,
};

/** Pure countdown calculation shared by web and mobile. targetAt must be a
 * complete ISO timestamp so neither client reconstructs a timezone locally.
 */
export function getCountdownParts(
  targetAt?: string | null,
  nowMillis = Date.now(),
): CountdownParts {
  const targetMillis = targetAt ? Date.parse(targetAt) : Number.NaN;
  if (!Number.isFinite(targetMillis)) return EMPTY;
  const remaining = targetMillis - nowMillis;
  if (remaining <= 0) return { ...EMPTY, valid: true };
  const secondsTotal = Math.floor(remaining / 1000);
  return {
    days: Math.floor(secondsTotal / 86400),
    hours: Math.floor((secondsTotal % 86400) / 3600),
    minutes: Math.floor((secondsTotal % 3600) / 60),
    seconds: secondsTotal % 60,
    isPast: false,
    isStartingSoon: remaining < 86_400_000,
    valid: true,
  };
}
