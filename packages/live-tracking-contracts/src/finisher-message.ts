export const FINISHER_MESSAGES = [
  'You kept moving when it was hard, and that courage carried you to the finish.',
  'Every kilometre tested you; every step proved what you are capable of.',
  'This finish was built from every quiet decision not to give up.',
  'Strength brought you here, determination carried you through.',
  'Today’s finish is proof that hard things become possible one step at a time.',
] as const;

function stableHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** A varied but refresh-stable message for a finisher. */
export function finisherMessageFor(identity: string | null | undefined): string {
  const key = String(identity ?? '').trim() || 'bergman-finisher';
  return FINISHER_MESSAGES[stableHash(key) % FINISHER_MESSAGES.length];
}
