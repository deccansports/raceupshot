/**
 * Keeps the contiguous completed prefix and reveals at most one next item.
 * A later/out-of-order completion is never allowed to expose hidden course
 * checkpoints before canonical reconciliation fills the missing boundary.
 */
export function revealProgressiveItems<T>(
  items: readonly T[],
  isCompleted: (item: T) => boolean,
  finished = false,
): T[] {
  if (finished) return [...items];
  let completedPrefixLength = 0;
  while (
    completedPrefixLength < items.length
    && isCompleted(items[completedPrefixLength])
  ) {
    completedPrefixLength += 1;
  }
  return items.slice(0, Math.min(items.length, completedPrefixLength + 1));
}
