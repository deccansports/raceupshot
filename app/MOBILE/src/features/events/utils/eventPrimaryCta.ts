import type { LiveEventItem } from "@/features/events/hooks/useEvents";

export type MobileEventPrimaryCtaType =
  "RESULTS" | "LIVE" | "SOLD_OUT" | "REGISTER" | "DETAILS";

function token(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

function truthy(value: unknown): boolean {
  return (
    value === true || value === 1 || ["true", "yes"].includes(token(value))
  );
}

function visibleRows(value: unknown): Record<string, unknown>[] {
  return (Array.isArray(value) ? value : []).filter((item) => {
    if (!item || typeof item !== "object") return false;
    const row = item as Record<string, unknown>;
    const visibility = token(row.visibility);
    return !truthy(row.isHidden ?? row.hidden) && visibility !== "hidden";
  }) as Record<string, unknown>[];
}

function soldOut(row: Record<string, unknown>): boolean {
  if (
    truthy(row.isSoldOut ?? row.soldOut) ||
    ["sold_out", "soldout"].includes(token(row.status))
  )
    return true;
  const remaining = Number(
    row.available_slots ?? row.availableSlots ?? row.slotsRemaining,
  );
  if (Number.isFinite(remaining) && remaining <= 0) return true;
  const subcategories = visibleRows(row.subCategories ?? row.subcategories);
  if (subcategories.length > 0) return subcategories.every(soldOut);
  const tiers = visibleRows(row.tiers ?? row.pricingTiers);
  return tiers.length > 0 && tiers.every(soldOut);
}

export function getMobileEventPrimaryCta(
  event: LiveEventItem,
): MobileEventPrimaryCtaType {
  const backendType = token(event.primaryCta?.type).toUpperCase();
  const raw = event.raw ?? {};
  const status = token(raw.status ?? raw.eventStatus ?? event.status);
  if (
    backendType === "RESULTS" ||
    raw.resultsPublished === true ||
    raw.officialResultsPublished === true ||
    raw.results_published === true ||
    raw.hasPublishedResults === true ||
    token(raw.resultState) === "published" ||
    status === "results_published"
  )
    return "RESULTS";
  if (backendType === "LIVE" || event.status === "live" || status === "live")
    return "LIVE";
  if (
    event.status === "finished" ||
    ["finished", "completed", "ended"].includes(status)
  )
    return "DETAILS";
  const tickets = (event.ticketDefinitions ?? []).filter(
    (ticket) =>
      ticket.active !== false &&
      ticket.isHidden !== true &&
      ticket.hidden !== true,
  );
  if (
    backendType === "SOLD_OUT" ||
    truthy(raw.isSoldOut ?? raw.soldOut) ||
    (tickets.length > 0 && tickets.every(soldOut))
  )
    return "SOLD_OUT";
  if (backendType === "REGISTER" || backendType === "DETAILS") {
    return backendType;
  }
  const registrationState = token(
    raw.registrationButtonState ?? raw.registrationStatus,
  );
  return ["hide", "hidden", "closed", "registration_closed"].includes(
    registrationState,
  )
    ? "DETAILS"
    : "REGISTER";
}

export function mobileEventCtaLabel(type: MobileEventPrimaryCtaType): string {
  if (type === "LIVE") return "Live Tracking";
  if (type === "RESULTS") return "Results";
  if (type === "SOLD_OUT") return "Sold Out";
  if (type === "REGISTER") return "Register Now";
  return "Details";
}
