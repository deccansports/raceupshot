import { describe, expect, it } from "vitest";
import { paidFoodCouponInput } from "./volunteer-paid-food";

describe("paidFoodCouponInput", () => {
  it("accepts an event-scoped confirmed order and normalizes optional contact fields", () => {
    const parsed = paidFoodCouponInput.parse({
      eventId: "event-1", orderId: "ORDER-1001", buyerName: "Vaibhav",
      itemName: "Lunch", amountPaisa: 25000,
    });
    expect(parsed).toMatchObject({ eventId: "event-1", orderId: "ORDER-1001", buyerMobile: "", amountPaisa: 25000 });
  });

  it("rejects malformed emails and coupon codes shorter than four characters", () => {
    expect(paidFoodCouponInput.safeParse({ eventId: "event-1", orderId: "O1", buyerName: "Test", buyerEmail: "bad", itemName: "Meal", code: "12" }).success).toBe(false);
  });
});
