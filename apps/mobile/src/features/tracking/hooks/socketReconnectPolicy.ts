export const MAX_CONSECUTIVE_TRANSPORT_FAILURES = 3;
export const TRANSPORT_FAILURE_COOLDOWN_MS = 60_000;

export type SocketReconnectDecision =
  | { kind: 'retry'; attempts: number; delayMs: number }
  | { kind: 'cooldown'; attempts: number; delayMs: number; until: number };

/** Keep socket retry behavior bounded so HTTP queries remain the fallback. */
export function nextSocketReconnectDecision(
  previousAttempts: number,
  now = Date.now(),
  cooldownProbe = false,
): SocketReconnectDecision {
  const attempts = previousAttempts + 1;
  if (cooldownProbe || attempts >= MAX_CONSECUTIVE_TRANSPORT_FAILURES) {
    return {
      kind: 'cooldown',
      attempts,
      delayMs: TRANSPORT_FAILURE_COOLDOWN_MS,
      until: now + TRANSPORT_FAILURE_COOLDOWN_MS,
    };
  }
  return {
    kind: 'retry',
    attempts,
    delayMs: Math.min(15_000, 500 * 2 ** Math.min(attempts, 5)),
  };
}
