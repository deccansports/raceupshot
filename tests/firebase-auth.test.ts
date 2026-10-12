import { FirebaseAuthenticationError, identityFromFirebaseClaims } from "../lib/firebase-auth-server";
import { describe, expect, it } from "vitest";

describe("Firebase athlete identity claims", () => {
  it("maps trusted Firebase claims to the private athlete identity contract", () => {
    const identity = identityFromFirebaseClaims({
      sub: "firebase-user-123",
      auth_time: Math.floor(Date.now() / 1000) - 10,
      email: "athlete@example.com",
      email_verified: true,
      name: "River Runner",
      firebase: { sign_in_provider: "password" },
    });

    expect(identity).toEqual({
      uid: "firebase-user-123",
      email: "athlete@example.com",
      emailVerified: true,
      name: "River Runner",
      picture: null,
      signInProvider: "password",
    });
  });

  it("rejects empty subjects and future authentication times", () => {
    expect(() => identityFromFirebaseClaims({
      sub: "",
      auth_time: Math.floor(Date.now() / 1000),
    })).toThrow(FirebaseAuthenticationError);

    expect(() => identityFromFirebaseClaims({
      sub: "firebase-user-123",
      auth_time: Math.floor(Date.now() / 1000) + 60,
    })).toThrow(FirebaseAuthenticationError);
  });
});
