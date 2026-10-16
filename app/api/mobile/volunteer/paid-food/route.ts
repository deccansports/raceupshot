import { apiFailure, apiSuccess } from "@/lib/api-response";
import { mobileCorsHeaders, mobileCorsPreflight } from "@/lib/mobile-cors";
import { requireVolunteer } from "@/lib/volunteer-auth";
import { activeAssignment, requireModule } from "@/lib/volunteer-operations";
import { listVolunteerPaidFoodCoupons, redeemVolunteerPaidFoodCoupon } from "@/lib/volunteer-paid-food";
import { z } from "@/lib/zod";

export const dynamic = "force-dynamic";
export const OPTIONS = mobileCorsPreflight;

export async function GET(request: Request) {
  try {
    const { profile } = await requireVolunteer(request); const url = new URL(request.url);
    const eventId = url.searchParams.get("eventId")?.trim() || ""; const query = url.searchParams.get("query")?.trim() || "";
    if (!eventId || !query) return apiFailure("Event and coupon, order, mobile or email search are required.", 400, { headers: mobileCorsHeaders });
    requireModule(activeAssignment(profile, eventId), "PAID_FOOD_COUNTER");
    return apiSuccess({ coupons: (await listVolunteerPaidFoodCoupons(eventId, query)).slice(0, 25) }, { headers: { ...mobileCorsHeaders, "cache-control": "no-store" } });
  } catch (error) { const message = error instanceof Error ? error.message : "Unable to search paid-food coupons."; return apiFailure(message, /AUTH_REQUIRED/.test(message) ? 401 : 400, { headers: mobileCorsHeaders }); }
}

export async function POST(request: Request) {
  try {
    const { profile } = await requireVolunteer(request);
    const parsed = z.object({ eventId: z.string().trim().min(1), code: z.string().trim().min(4).max(40) }).safeParse(await request.json());
    if (!parsed.success) return apiFailure("Event and coupon code are required.", 400, { headers: mobileCorsHeaders });
    requireModule(activeAssignment(profile, parsed.data.eventId), "PAID_FOOD_COUNTER");
    return apiSuccess(await redeemVolunteerPaidFoodCoupon({ ...parsed.data, volunteerId: profile.id, volunteerName: profile.name }), { headers: { ...mobileCorsHeaders, "cache-control": "no-store" } });
  } catch (error) { const message = error instanceof Error ? error.message : "Unable to redeem paid-food coupon."; return apiFailure(message, /already redeemed/i.test(message) ? 409 : /AUTH_REQUIRED/.test(message) ? 401 : 400, { headers: mobileCorsHeaders }); }
}
