import { describe, expect, it } from "vitest";
import { calculateVolunteerOperationCounters } from "@/lib/volunteer-operation-counters";

describe("volunteer operation counters", () => {
  it("uses waivered athletes, entered bikes, and active bikes as separate denominators", () => {
    const participants = [
      { id: "a", chipCode: "CHIP-A", registrationWaiverVerifiedAt: null },
      { id: "b", chipCode: "CHIP-B", registrationWaiverVerifiedAt: "SIGNED" },
      { id: "c", chipCode: "CHIP-C", registrationWaiverVerifiedAt: "SIGNED" },
      { id: "d", chipCode: "", registrationWaiverVerifiedAt: null },
    ];
    const states = {
      a: { checkedInAt: "yes", waiverVerifiedAt: "yes", bikeCheckedInAt: "yes", bikeCheckedOutAt: null },
      b: { checkedInAt: null, waiverVerifiedAt: null, bikeCheckedInAt: "yes", bikeCheckedOutAt: "yes" },
      c: { checkedInAt: null, waiverVerifiedAt: null, bikeCheckedInAt: null, bikeCheckedOutAt: null },
      d: { checkedInAt: null, waiverVerifiedAt: null, bikeCheckedInAt: "yes", bikeCheckedOutAt: null },
    };
    expect(calculateVolunteerOperationCounters(participants, states)).toMatchObject({
      totalAthletes: 4,
      checkedInAthletes: 1,
      remainingToCheckIn: 3,
      waiverCompletedAthletes: 3,
      bikesEverCheckedIn: 3,
      bikesCheckedIn: 2,
      bikesCheckedOut: 1,
      remainingToBikeCheckIn: 1,
      remainingToBikeCheckOut: 2,
      chipsAssigned: 3,
      chipsAssignedToBikeEntries: 2,
      remainingToAssignFromBikeEntries: 1,
    });
  });

  it("does not create negative remaining counts", () => {
    const result = calculateVolunteerOperationCounters(
      [{ id: "a", chipCode: "", registrationWaiverVerifiedAt: null }],
      { a: { checkedInAt: null, waiverVerifiedAt: null, bikeCheckedInAt: "yes", bikeCheckedOutAt: "yes" } },
    );
    expect(result.remainingToBikeCheckIn).toBe(0);
    expect(result.remainingToBikeCheckOut).toBe(0);
  });
});
