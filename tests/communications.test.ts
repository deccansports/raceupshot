import { describe, expect, it } from "vitest";
import { renderCommunicationEmail, summarizeCommunicationCampaign, type CommunicationCampaign } from "../lib/communications";
import { prepareEmailHtml } from "../lib/bergtecno-email";

describe("communication HTML rendering", () => {
  it("sends the pasted HTML document without escaping or wrapping it", () => {
    const rendered = renderCommunicationEmail(
      "Copied admin text\n<!DOCTYPE html><html><body><h1>{{ params.event_name }}</h1><p>{{name}}</p></body></html>",
      "HTML",
      "Vaibhav & Team",
      { event_name: "Test 1234" },
    );

    expect(rendered).toBe(
      "<!DOCTYPE html><html><body><h1>Test 1234</h1><p>Vaibhav &amp; Team</p></body></html>",
    );
    expect(rendered).not.toContain("&lt;html");
    expect(rendered).not.toContain("Copied admin text");
  });

  it("keeps large HTML documents intact", () => {
    const body = "A".repeat(40_000);
    const rendered = renderCommunicationEmail(`<!doctype html><html><body>${body}</body></html>`, "HTML");

    expect(rendered).toContain(body);
    expect(rendered.length).toBeGreaterThan(40_000);
  });

  it("inlines class CSS before provider delivery", () => {
    const rendered = prepareEmailHtml(
      "<!doctype html><html><head><style>.hero{color:#00c8ff;padding:20px}.hero strong{font-weight:800}</style></head><body><div class=\"hero\"><strong>Race Upshot</strong></div></body></html>",
    );

    expect(rendered).toMatch(/class="hero"[^>]*style="[^"]*color:\s*#00c8ff/i);
    expect(rendered).toMatch(/class="hero"[^>]*style="[^"]*padding:\s*20px/i);
    expect(rendered).toMatch(/<strong style="font-weight:\s*800/i);
  });

  it("resolves CSS variables and removes scripts before delivery", () => {
    const rendered = prepareEmailHtml(
      "<!doctype html><html><head><script>localStorage.setItem('theme','dark')</script><style>:root{--blue:#0b5ed7}.rules-block{color:var(--blue);padding:28px}</style></head><body><section class=\"rules-block\">Rules</section></body></html>",
    );

    expect(rendered).toMatch(/class="rules-block"[^>]*style="[^"]*color:\s*#0b5ed7/i);
    expect(rendered).toMatch(/class="rules-block"[^>]*style="[^"]*padding:\s*28px/i);
    expect(rendered).not.toContain("<script");
    expect(rendered).not.toContain("localStorage");
  });
});

describe("bulk communication delivery states", () => {
  function campaign(statuses: CommunicationCampaign["recipients"][number]["status"][]): CommunicationCampaign {
    return {
      id: "campaign-1",
      providerCampaignId: "raceupshot-campaign-1",
      scope: "GLOBAL",
      eventId: "",
      subject: "Race update",
      message: "Update",
      contentType: "TEXT",
      variables: {},
      filters: { country: "", state: "", city: "", category: "" },
      status: "QUEUED",
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
      recipients: statuses.map((status, index) => ({
        email: `athlete${index}@example.com`,
        name: `Athlete ${index}`,
        country: "",
        state: "",
        city: "",
        categories: [],
        eventIds: [],
        clientMessageId: `message-${index}`,
        status,
      })),
      sentCount: 0,
      failedCount: 0,
    };
  }

  it("does not label queued or SES-accepted messages as delivered", () => {
    const summary = summarizeCommunicationCampaign(campaign(["QUEUED", "SES_ACCEPTED", "DELIVERED"]));

    expect(summary.status).toBe("QUEUED");
    expect(summary.queuedCount).toBe(1);
    expect(summary.sesAcceptedCount).toBe(2);
    expect(summary.deliveredCount).toBe(1);
  });

  it("counts delivered, suppressed, bounced, and complained terminal outcomes", () => {
    const summary = summarizeCommunicationCampaign(campaign(["DELIVERED", "SUPPRESSED", "BOUNCED", "COMPLAINED"]));

    expect(summary.status).toBe("PARTIAL_FAILURE");
    expect(summary.deliveredCount).toBe(1);
    expect(summary.suppressedCount).toBe(1);
    expect(summary.sesAcceptedCount).toBe(3);
    expect(summary.failedCount).toBe(2);
  });
});
