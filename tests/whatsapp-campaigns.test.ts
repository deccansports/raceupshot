import { describe, expect, it } from "vitest";
import { isAuthorizedWhatsAppCampaignEvent, resolveWhatsAppParameter, whatsappCampaignInput, type WhatsAppCampaignRecipient } from "../lib/whatsapp-campaigns";

const recipient: WhatsAppCampaignRecipient = {
  id: "athlete-1",
  name: "Aman Singh",
  email: "aman@example.com",
  mobile: "+918390288857",
  bib: "3001",
  category: "Olympic Triathlon",
  eventName: "New Test",
  status: "PENDING",
};

describe("WhatsApp campaigns", () => {
  it("resolves ordered AiSensy parameters without changing their sequence", () => {
    const configured = ["{{name}}", "{{bib}}", "{{event_name}}", "Static footer"];
    expect(configured.map((value) => resolveWhatsAppParameter(value, recipient))).toEqual([
      "Aman Singh",
      "3001",
      "New Test",
      "Static footer",
    ]);
  });

  it("requires provider media to use HTTPS", () => {
    const result = whatsappCampaignInput.safeParse({
      eventId: "new-test",
      participantId: "",
      targetType: "EVENT",
      campaignLabel: "Race update",
      campaignName: "race_update",
      categories: [],
      parameters: [{ value: "{{name}}" }],
      mediaUrl: "http://example.com/header.pdf",
      mediaFilename: "header.pdf",
    });
    expect(result.success).toBe(false);
  });

  it("keeps outbound campaigns locked to the authorized test event", () => {
    expect(isAuthorizedWhatsAppCampaignEvent("New Test")).toBe(true);
    expect(isAuthorizedWhatsAppCampaignEvent("Udupi Triathlon")).toBe(false);
  });
});
