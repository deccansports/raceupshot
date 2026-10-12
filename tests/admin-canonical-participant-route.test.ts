import { beforeEach, describe, expect, it, vi } from "vitest";

const { authenticate, loadDetail } = vi.hoisted(() => ({ authenticate: vi.fn(), loadDetail: vi.fn() }));

vi.mock("@/lib/admin-auth", () => ({ getAuthenticatedAdminEmail: authenticate }));
vi.mock("@/lib/platform-repository", () => ({ getAdminLiveParticipantDetail: loadDetail }));

import { GET } from "@/app/api/v1/admin/events/[eventId]/participants/[participantId]/canonical/route";

const context = { params: Promise.resolve({ eventId: "race-1", participantId: "feibot-1" }) };

describe("admin canonical participant detail", () => {
  beforeEach(() => {
    authenticate.mockReset();
    loadDetail.mockReset();
    authenticate.mockResolvedValue("admin@example.com");
  });

  it("opens a version-pinned Feibot participant without requiring a registration row", async () => {
    const detail = { participant: { participantUid: "feibot-1" }, canonical: { buildVersion: "v3" } };
    loadDetail.mockResolvedValue(detail);
    const response = await GET(new Request("https://example.test/"), context);
    expect(response.status).toBe(200);
    expect(loadDetail).toHaveBeenCalledWith("race-1", "feibot-1", true);
    expect(await response.json()).toMatchObject({ ok: true, data: detail });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("does not relabel a registration-only record as canonical", async () => {
    loadDetail.mockResolvedValue({ canonical: { buildVersion: null } });
    const response = await GET(new Request("https://example.test/"), context);
    expect(response.status).toBe(404);
  });

  it("requires an admin session", async () => {
    authenticate.mockResolvedValue(null);
    const response = await GET(new Request("https://example.test/"), context);
    expect(response.status).toBe(401);
    expect(loadDetail).not.toHaveBeenCalled();
  });
});
