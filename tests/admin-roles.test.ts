import { describe, expect, it } from "vitest";
import { adminRoleAssignmentInput } from "../lib/admin-roles";

describe("admin role assignment contract", () => {
  it("requires an event for event-scoped access", () => {
    const result = adminRoleAssignmentInput.safeParse({
      userId: "firebase-user",
      roleId: "EVENT_ADMIN",
      scope: "EVENT",
      eventIds: [],
    });

    expect(result.success).toBe(false);
  });

  it("requires Super Admin access to be global", () => {
    const result = adminRoleAssignmentInput.safeParse({
      userId: "firebase-user",
      roleId: "SUPER_ADMIN",
      scope: "EVENT",
      eventIds: ["event-1"],
    });

    expect(result.success).toBe(false);
  });

  it("accepts a valid event-scoped assignment", () => {
    const result = adminRoleAssignmentInput.safeParse({
      userId: "firebase-user",
      roleId: "TIMING_OPERATOR",
      scope: "EVENT",
      eventIds: ["event-1"],
    });

    expect(result.success).toBe(true);
  });
});
