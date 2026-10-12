import { describe, expect, it } from "vitest";
import { accountDestination } from "../lib/account-access";

describe("accountDestination", () => {
  it("opens the only linked portal", () => {
    expect(accountDestination(["ADMIN"])).toBe("/admin");
    expect(accountDestination(["ATHLETE"])).toBe("/athlete");
    expect(accountDestination(["VOLUNTEER"])).toBe("/volunteer");
  });

  it("uses a stable priority while preserving all roles for the account menu", () => {
    expect(accountDestination(["VOLUNTEER", "ATHLETE"])).toBe("/athlete");
    expect(accountDestination(["VOLUNTEER", "ADMIN", "ATHLETE"])).toBe("/admin");
  });

  it("rejects accounts without a linked role", () => {
    expect(accountDestination([])).toBeNull();
  });
});
