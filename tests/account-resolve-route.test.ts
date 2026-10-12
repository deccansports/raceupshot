import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireFirebaseAthlete: vi.fn(),
  getAthleteProfile: vi.fn(),
  getVolunteerByEmail: vi.fn(),
  isConfiguredAdminEmail: vi.fn(),
  createAdminSession: vi.fn(),
  createVolunteerSessionForEmail: vi.fn(),
}));

vi.mock("@/lib/firebase-auth-server", () => ({
  FirebaseAuthenticationError: class FirebaseAuthenticationError extends Error {},
  requireFirebaseAthlete: mocks.requireFirebaseAthlete,
}));
vi.mock("@/lib/athlete-profile", () => ({ getAthleteProfile: mocks.getAthleteProfile }));
vi.mock("@/lib/volunteer-management", () => ({ getVolunteerByEmail: mocks.getVolunteerByEmail }));
vi.mock("@/lib/admin-auth", () => ({
  isConfiguredAdminEmail: mocks.isConfiguredAdminEmail,
  createAdminSession: mocks.createAdminSession,
}));
vi.mock("@/lib/volunteer-auth", () => ({ createVolunteerSessionForEmail: mocks.createVolunteerSessionForEmail }));

import { POST } from "../app/api/auth/resolve/route";

const request = () => new Request("https://raceupshot.com/api/auth/resolve", {
  method: "POST",
  headers: { authorization: "Bearer firebase-token" },
});

describe("account access resolver", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireFirebaseAthlete.mockResolvedValue({
      uid: "firebase-user-1",
      email: "user@example.com",
      emailVerified: true,
      name: "Race User",
    });
    mocks.getAthleteProfile.mockResolvedValue(null);
    mocks.getVolunteerByEmail.mockResolvedValue(null);
    mocks.isConfiguredAdminEmail.mockResolvedValue(false);
    mocks.createAdminSession.mockResolvedValue(undefined);
    mocks.createVolunteerSessionForEmail.mockResolvedValue({ sessionToken: "volunteer-session" });
  });

  it("creates the admin session and opens admin for the configured verified email", async () => {
    mocks.isConfiguredAdminEmail.mockResolvedValue(true);

    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({ roles: ["ADMIN"], destination: "/admin" });
    expect(mocks.createAdminSession).toHaveBeenCalledWith("user@example.com");
  });

  it("opens a linked athlete without granting admin or volunteer access", async () => {
    mocks.getAthleteProfile.mockResolvedValue({ uid: "firebase-user-1", name: "Race User" });

    const response = await POST(request());
    const body = await response.json();

    expect(body.data).toMatchObject({ roles: ["ATHLETE"], destination: "/athlete" });
    expect(mocks.createAdminSession).not.toHaveBeenCalled();
    expect(mocks.createVolunteerSessionForEmail).not.toHaveBeenCalled();
  });

  it("creates a volunteer session only for an active linked volunteer", async () => {
    mocks.getVolunteerByEmail.mockResolvedValue({
      id: "volunteer-1",
      status: "ACTIVE",
      assignments: [{ active: true }],
    });

    const response = await POST(request());
    const body = await response.json();

    expect(body.data).toMatchObject({
      roles: ["VOLUNTEER"],
      destination: "/volunteer",
      volunteerSessionToken: "volunteer-session",
    });
    expect(mocks.createVolunteerSessionForEmail).toHaveBeenCalledWith("user@example.com");
  });

  it("does not grant a role to an unlinked Firebase account", async () => {
    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toContain("No active admin, athlete, or volunteer profile");
  });
});
