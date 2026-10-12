import type { PrintParticipant } from "./bib-print-layout";

type Ticket = readonly [id: string, name: string];
type CategoryEvent = {
  tickets?: { id: string; name: string }[];
  ticketDefinitions?: { id: string; name: string }[];
  categories?: string[];
};

// Ticket names can arrive from spreadsheet imports and provider configuration with
// zero-width direction/formatting characters. Those characters render identically
// in a <select>, but previously produced different Map keys and duplicate options.
const INVISIBLE_CATEGORY_CHARACTERS = /[\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180b-\u180f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g;

export const cleanBibPrintCategoryName = (name: string) => name
  .normalize("NFKC")
  .replace(INVISIBLE_CATEGORY_CHARACTERS, "")
  .trim()
  .replace(/\s+/g, " ");

const categoryKey = (name: string) => cleanBibPrintCategoryName(name).toLocaleLowerCase();

/** Prefer the roster's ticket ID when the event configuration calls it by the same name. */
export function bibPrintCategoryOptions(
  event: CategoryEvent | undefined,
  participants: Pick<PrintParticipant, "ticketId" | "ticketName">[],
): Ticket[] {
  const configured = new Map<string, string>();
  for (const ticket of [...(event?.tickets ?? []), ...(event?.ticketDefinitions ?? [])]) {
    const name = cleanBibPrintCategoryName(ticket.name);
    if (ticket.id && name && !configured.has(ticket.id)) configured.set(ticket.id, name);
  }
  if (!configured.size) {
    for (const [index, name] of (event?.categories ?? []).entries()) {
      const id = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || `ticket-${index + 1}`;
      const displayName = cleanBibPrintCategoryName(name);
      if (!configured.has(id) && displayName) configured.set(id, displayName);
    }
  }

  const roster = new Map<string, string>();
  for (const participant of participants) {
    if (participant.ticketId && !roster.has(participant.ticketId)) {
      roster.set(participant.ticketId, cleanBibPrintCategoryName(participant.ticketName || participant.ticketId));
    }
  }

  const groups = new Map<string, { configured: Ticket[]; roster: Ticket[] }>();
  const add = (id: string, name: string, source: "configured" | "roster") => {
    const key = categoryKey(name);
    if (!key) return;
    const group = groups.get(key) ?? { configured: [], roster: [] };
    group[source].push([id, name]);
    groups.set(key, group);
  };
  for (const [id, name] of configured) add(id, name, "configured");
  for (const [id, name] of roster) add(id, name, "roster");

  const options: Ticket[] = [];
  const usedIds = new Set<string>();
  for (const group of groups.values()) {
    // `tickets` and `ticketDefinitions` are two projections of the same event
    // configuration and may use different internal IDs. They must still produce
    // one category choice. Multiple IDs found in the actual roster are retained
    // because those can represent independently printable registrations/waves.
    const preferred = group.roster.length ? group.roster : group.configured.slice(0, 1);
    for (const [id, name] of preferred) {
      if (usedIds.has(id)) continue;
      usedIds.add(id);
      options.push([id, preferred.length > 1 ? `${name} · ${id}` : name]);
    }
  }
  return options;
}
