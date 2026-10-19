import type { FinishLineLedLogo } from "./finish-line-led";

export function resolveLedLogos(available: FinishLineLedLogo[], selected: FinishLineLedLogo[], syncEventLogos = true): FinishLineLedLogo[] {
  const byId = new Map(available.map((logo) => [logo.id, logo]));
  const refreshed = selected.flatMap((logo) => {
    const current = byId.get(logo.id);
    if (current) return [current];
    // Deleted source logos must not survive as stale saved copies.
    if (logo.id.startsWith("event:") || logo.id.startsWith("partner:")) return [];
    return [logo];
  });
  const seenIds = new Set<string>();
  const seenUrls = new Set<string>();
  return [...(syncEventLogos ? available : []), ...refreshed].filter((logo) => {
    if (seenIds.has(logo.id) || seenUrls.has(logo.logoUrl)) return false;
    seenIds.add(logo.id);
    seenUrls.add(logo.logoUrl);
    return true;
  });
}
