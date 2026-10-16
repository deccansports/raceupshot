import { requireAdmin } from "@/lib/admin-guard";
import { apiFailure, apiSuccess } from "@/lib/api-response";
import { createVolunteerPaidFoodCoupon, listVolunteerPaidFoodCoupons, paidFoodCouponInput } from "@/lib/volunteer-paid-food";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const denied = await requireAdmin(); if (denied) return denied;
  try {
    const url = new URL(request.url); const eventId = url.searchParams.get("eventId")?.trim() || ""; const query = url.searchParams.get("query")?.trim() || "";
    if (!eventId) return apiFailure("Event ID is required.", 400);
    return apiSuccess(await listVolunteerPaidFoodCoupons(eventId, query), { headers: { "cache-control": "private, no-store" } });
  } catch (error) { return apiFailure(error instanceof Error ? error.message : "Unable to load paid-food coupons.", 400); }
}
export async function POST(request: Request) {
  const denied = await requireAdmin(); if (denied) return denied;
  try {
    const parsed = paidFoodCouponInput.safeParse(await request.json());
    if (!parsed.success) return apiFailure(parsed.error.issues[0]?.message || "Invalid paid-food coupon.", 400);
    return apiSuccess(await createVolunteerPaidFoodCoupon(parsed.data), { status: 201 });
  } catch (error) { return apiFailure(error instanceof Error ? error.message : "Unable to create paid-food coupon.", 400); }
}
