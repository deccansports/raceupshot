import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { KVNamespace } from "@cloudflare/workers-types";
import { mapWithConcurrency } from "./map-with-concurrency";
import { withTransientKvRetry } from "./kv-retry";
import { z } from "./zod";

const PREFIX = "raceupshot:volunteer:custom-counter";
const INDEX_KEY = `${PREFIX}:index`;
const ISSUE_INDEX_KEY = `${PREFIX}:issue:index`;

export const customCounterInput = z.object({
  id: z.string().trim().max(150).optional(),
  eventId: z.string().trim().min(1, "Choose an event."),
  name: z.string().trim().min(2, "Enter a counter name.").max(100),
  itemName: z.string().trim().min(1, "Enter the item or action name.").max(100),
  actionLabel: z.string().trim().min(1).max(100).default("Issue"),
  active: z.boolean().default(true),
  volunteersEligible: z.boolean().default(false),
  applicableCategories: z.array(z.string().trim().min(1).max(120)).max(100).default([]),
  inventoryUnit: z.enum(["litre", "kilogram", "piece", "packet", "custom"]).default("piece"),
  unitLabel: z.string().trim().max(40).default("piece"),
  totalInventoryQuantity: z.number().min(0).nullable().default(null),
  totalServings: z.number().int().min(0).nullable().default(null),
  purchaseRatePaisaPerUnit: z.number().int().min(0).default(0),
  quantityPerServing: z.number().positive().default(1),
  maxPerParticipant: z.number().int().min(1).max(100).default(1),
});

export type CustomCounterInput = z.infer<typeof customCounterInput>;

export interface VolunteerCustomCounter extends CustomCounterInput {
  id: string;
  createdAt: string;
  updatedAt: string;
}

export interface VolunteerCustomCounterIssue {
  id: string;
  counterId: string;
  eventId: string;
  participantUid: string;
  bib: string;
  athleteName: string;
  volunteerId: string;
  volunteerName: string;
  quantity: number;
  capturedAt: string;
  status: "ISSUED" | "RESET";
  reversesIssueId?: string;
}

async function kv(): Promise<KVNamespace> {
  const { env } = await getCloudflareContext({ async: true });
  if (!env.RACEUPSHOT) throw new Error("RACEUPSHOT KV binding is unavailable.");
  return withTransientKvRetry(env.RACEUPSHOT);
}

async function readIndex(store: KVNamespace, key: string): Promise<string[]> {
  const value = await store.get<unknown>(key, "json");
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

async function appendIndex(store: KVNamespace, key: string, id: string) {
  const ids = await readIndex(store, key);
  if (!ids.includes(id)) await store.put(key, JSON.stringify([...ids, id]));
}

function counterKey(id: string) { return `${PREFIX}:${encodeURIComponent(id)}`; }
function issueKey(id: string) { return `${PREFIX}:issue:${encodeURIComponent(id)}`; }

export async function listVolunteerCustomCounters(eventId?: string): Promise<VolunteerCustomCounter[]> {
  const store = await kv();
  const ids = await readIndex(store, INDEX_KEY);
  const rows = await mapWithConcurrency(ids, 8, (id) => store.get<VolunteerCustomCounter>(counterKey(id), "json"));
  return rows.filter((row): row is VolunteerCustomCounter => Boolean(row))
    .map((row) => ({
      ...row,
      volunteersEligible: row.volunteersEligible ?? false,
      totalInventoryQuantity: row.totalInventoryQuantity ?? null,
      totalServings: row.totalServings ?? null,
      purchaseRatePaisaPerUnit: row.purchaseRatePaisaPerUnit ?? 0,
      quantityPerServing: row.quantityPerServing || 1,
      maxPerParticipant: row.maxPerParticipant || 1,
    }))
    .filter((row) => !eventId || row.eventId === eventId)
    .sort((left, right) => left.name.localeCompare(right.name));
}

export async function saveVolunteerCustomCounter(input: CustomCounterInput): Promise<VolunteerCustomCounter> {
  const store = await kv();
  const now = new Date().toISOString();
  const existing = input.id ? await store.get<VolunteerCustomCounter>(counterKey(input.id), "json") : null;
  if (existing && existing.eventId !== input.eventId) throw new Error("A custom counter cannot be moved to another event.");
  const row: VolunteerCustomCounter = {
    ...input,
    id: input.id || crypto.randomUUID(),
    unitLabel: input.unitLabel.trim() || input.inventoryUnit,
    applicableCategories: [...new Set(input.applicableCategories.map((value) => value.trim()).filter(Boolean))],
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
  await Promise.all([store.put(counterKey(row.id), JSON.stringify(row)), appendIndex(store, INDEX_KEY, row.id)]);
  return row;
}

export async function deleteVolunteerCustomCounter(id: string): Promise<void> {
  const store = await kv();
  const issueRows = await listVolunteerCustomCounterIssues(undefined, id);
  if (issueRows.some((row) => row.status === "ISSUED")) throw new Error("This counter has issue history. Disable it instead of deleting it.");
  const ids = await readIndex(store, INDEX_KEY);
  await Promise.all([store.delete(counterKey(id)), store.put(INDEX_KEY, JSON.stringify(ids.filter((value) => value !== id)))]);
}

export async function listVolunteerCustomCounterIssues(eventId?: string, counterId?: string): Promise<VolunteerCustomCounterIssue[]> {
  const store = await kv();
  const ids = await readIndex(store, ISSUE_INDEX_KEY);
  const selected = ids.slice(-500).reverse();
  const rows = await mapWithConcurrency(selected, 8, (id) => store.get<VolunteerCustomCounterIssue>(issueKey(id), "json"));
  return rows.filter((row): row is VolunteerCustomCounterIssue => Boolean(row))
    .filter((row) => (!eventId || row.eventId === eventId) && (!counterId || row.counterId === counterId));
}

export async function issueVolunteerCustomCounter(input: Omit<VolunteerCustomCounterIssue, "id" | "capturedAt" | "status">): Promise<VolunteerCustomCounterIssue> {
  const store = await kv();
  const counter = await store.get<VolunteerCustomCounter>(counterKey(input.counterId), "json");
  if (!counter || counter.eventId !== input.eventId || !counter.active) throw new Error("This custom counter is not active for the event.");
  const history = await listVolunteerCustomCounterIssues(input.eventId, counter.id);
  const resetIds = new Set(history.filter((row) => row.status === "RESET" && row.reversesIssueId).map((row) => row.reversesIssueId));
  const participantIssues = history.filter((row) => row.status === "ISSUED" && row.participantUid === input.participantUid && !resetIds.has(row.id));
  if (participantIssues.length >= counter.maxPerParticipant) throw new Error(`${counter.itemName} has already been recorded for this athlete.`);
  const issued = history.filter((row) => row.status === "ISSUED" && !resetIds.has(row.id)).reduce((sum, row) => sum + row.quantity, 0);
  if (counter.totalServings !== null && issued + input.quantity > counter.totalServings) throw new Error(`${counter.name} has no remaining servings.`);
  const row: VolunteerCustomCounterIssue = { ...input, id: crypto.randomUUID(), capturedAt: new Date().toISOString(), status: "ISSUED" };
  await Promise.all([store.put(issueKey(row.id), JSON.stringify(row)), appendIndex(store, ISSUE_INDEX_KEY, row.id)]);
  return row;
}

export async function resetVolunteerCustomCounterIssue(issueId: string): Promise<VolunteerCustomCounterIssue> {
  const store = await kv();
  const original = await store.get<VolunteerCustomCounterIssue>(issueKey(issueId), "json");
  if (!original || original.status !== "ISSUED") throw new Error("Custom counter issue was not found.");
  const history = await listVolunteerCustomCounterIssues(original.eventId, original.counterId);
  if (history.some((row) => row.status === "RESET" && row.reversesIssueId === original.id)) throw new Error("This issue has already been reset.");
  const row: VolunteerCustomCounterIssue = {
    ...original,
    id: crypto.randomUUID(),
    volunteerId: "admin",
    volunteerName: "Race Upshot admin",
    capturedAt: new Date().toISOString(),
    status: "RESET",
    reversesIssueId: original.id,
  };
  await Promise.all([store.put(issueKey(row.id), JSON.stringify(row)), appendIndex(store, ISSUE_INDEX_KEY, row.id)]);
  return row;
}
