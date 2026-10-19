import type { ManualTimingStamp } from './types';

export function mergeTimingRefresh(current: ManualTimingStamp[], incoming: ManualTimingStamp[]): ManualTimingStamp[] {
  const localLatest = current.find(row => row.canReset === true);
  const serverLatest = incoming.find(row => row.canReset === true);
  const localOnServer = incoming.find(row => row.id === localLatest?.id);
  // A just-confirmed POST can precede the listing's KV visibility. Also support
  // old API responses which do not yet carry the reset permission field.
  const retainLocal = localLatest && (!localOnServer || (localOnServer.canReset === undefined && !serverLatest));
  const allowedId = retainLocal ? localLatest.id : serverLatest?.id;
  const previous = new Map(current.map(row => [row.id, row]));
  const rows = incoming.map(row => ({ ...previous.get(row.id), ...row, canReset: row.id === allowedId }));
  if (retainLocal && !localOnServer) rows.unshift({ ...localLatest, canReset: true });
  return rows.slice(0, 50);
}
