import { describe, expect, it } from "vitest";

import { createVolunteerPasswordCredential, verifyVolunteerPasswordCredential } from "@/lib/volunteer-password";

describe("volunteer password credentials", () => {
  it("hashes a password with a unique salt and verifies only the correct password", async () => {
    const first = await createVolunteerPasswordCredential("RaceDay#2026");
    const second = await createVolunteerPasswordCredential("RaceDay#2026");
    expect(first.hashHex).not.toBe("RaceDay#2026");
    expect(first.iterations).toBe(100_000);
    expect(first.saltHex).not.toBe(second.saltHex);
    expect(first.hashHex).not.toBe(second.hashHex);
    await expect(verifyVolunteerPasswordCredential("RaceDay#2026", first)).resolves.toBe(true);
    await expect(verifyVolunteerPasswordCredential("wrong-password", first)).resolves.toBe(false);
  });

  it("accepts six-character passwords and rejects shorter passwords", async () => {
    const credential = await createVolunteerPasswordCredential("123456");
    await expect(verifyVolunteerPasswordCredential("123456", credential)).resolves.toBe(true);
    await expect(createVolunteerPasswordCredential("12345")).rejects.toThrow("between 6 and 128 characters");
  });

  it("rejects legacy iteration counts that Cloudflare Workers cannot execute", async () => {
    const credential = await createVolunteerPasswordCredential("RaceDay#2026");
    await expect(verifyVolunteerPasswordCredential("RaceDay#2026", {
      ...credential,
      iterations: 210_000,
    })).resolves.toBe(false);
  });
});
