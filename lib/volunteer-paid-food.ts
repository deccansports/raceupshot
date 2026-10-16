import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { KVNamespace } from "@cloudflare/workers-types";
import { mapWithConcurrency } from "./map-with-concurrency";
import { withTransientKvRetry } from "./kv-retry";
import { z } from "./zod";

const PREFIX = "raceupshot:volunteer:paid-food";
const INDEX_KEY = `${PREFIX}:coupon:index`;

export const paidFoodCouponInput = z.object({
  eventId: z.string().trim().min(1),
  code: z.string().trim().min(4).max(40).optional(),
  orderId: z.string().trim().min(1).max(100),
  buyerName: z.string().trim().min(1).max(150),
  buyerEmail: z.string().trim().email().max(250).optional().or(z.literal("")),
  buyerMobile: z.string().trim().max(40).optional().default(""),
  itemName: z.string().trim().min(1).max(150),
  amountPaisa: z.number().int().min(0).default(0),
});

export interface VolunteerPaidFoodCoupon {
  code: string;
  eventId: string;
  orderId: string;
  buyerName: string;
  buyerEmail: string;
  buyerMobile: string;
  itemName: string;
  amountPaisa: number;
  status: "ISSUED" | "REDEEMED";
  createdAt: string;
  redeemedAt: string | null;
  redeemedById: string | null;
  redeemedByName: string | null;
}
async function kv(): Promise<KVNamespace> {
  const { env } = await getCloudflareContext({ async: true });
  if (!env.RACEUPSHOT) throw new Error("RACEUPSHOT KV binding is unavailable.");
  return withTransientKvRetry(env.RACEUPSHOT);
}

function couponKey(eventId: string, code: string) {
  return `${PREFIX}:coupon:${encodeURIComponent(eventId)}:${encodeURIComponent(code.toUpperCase())}`;
}

async function readIndex(store: KVNamespace): Promise<string[]> {
  const value = await store.get<unknown>(INDEX_KEY, "json");
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

async function generateCode(store: KVNamespace, eventId: string): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, "0");
    if (!await store.get(couponKey(eventId, code))) return code;
  }
  throw new Error("Unable to generate a unique paid-food coupon. Try again.");
}

export async function createVolunteerPaidFoodCoupon(input: z.infer<typeof paidFoodCouponInput>): Promise<VolunteerPaidFoodCoupon> {
  const store = await kv();
  const code = (input.code || await generateCode(store, input.eventId)).trim().toUpperCase();
  const key = couponKey(input.eventId, code);
  if (await store.get(key)) throw new Error(`Coupon ${code} already exists for this event.`);
  const row: VolunteerPaidFoodCoupon = {
    code, eventId: input.eventId, orderId: input.orderId, buyerName: input.buyerName,
    buyerEmail: input.buyerEmail || "", buyerMobile: input.buyerMobile || "", itemName: input.itemName,
    amountPaisa: input.amountPaisa, status: "ISSUED", createdAt: new Date().toISOString(),
    redeemedAt: null, redeemedById: null, redeemedByName: null,
  };
  const index = await readIndex(store);
  await Promise.all([store.put(key, JSON.stringify(row)), store.put(INDEX_KEY, JSON.stringify([...new Set([...index, key])]))]);
  return row;
}

export async function listVolunteerPaidFoodCoupons(eventId: string, query = ""): Promise<VolunteerPaidFoodCoupon[]> {
  const store = await kv();
  const keys = (await readIndex(store)).filter((key) => key.startsWith(`${PREFIX}:coupon:${encodeURIComponent(eventId)}:`)).slice(-1000).reverse();
  const rows = await mapWithConcurrency(keys, 8, (key) => store.get<VolunteerPaidFoodCoupon>(key, "json"));
  const term = query.trim().toLowerCase();
  return rows.filter((row): row is VolunteerPaidFoodCoupon => Boolean(row)).filter((row) => !term || [row.code, row.orderId, row.buyerName, row.buyerEmail, row.buyerMobile, row.itemName].some((value) => value.toLowerCase().includes(term)));
}

export async function redeemVolunteerPaidFoodCoupon(input: { eventId: string; code: string; volunteerId: string; volunteerName: string }): Promise<VolunteerPaidFoodCoupon> {
  const store = await kv();
  const key = couponKey(input.eventId, input.code);
  const row = await store.get<VolunteerPaidFoodCoupon>(key, "json");
  if (!row) throw new Error("Paid-food coupon was not found for this event.");
  if (row.status === "REDEEMED") throw new Error(`Coupon ${row.code} was already redeemed${row.redeemedAt ? ` on ${new Date(row.redeemedAt).toLocaleString("en-IN")}` : ""}.`);
  const redeemed: VolunteerPaidFoodCoupon = { ...row, status: "REDEEMED", redeemedAt: new Date().toISOString(), redeemedById: input.volunteerId, redeemedByName: input.volunteerName };
  await store.put(key, JSON.stringify(redeemed));
  return redeemed;
}
