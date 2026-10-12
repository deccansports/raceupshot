import { describe, expect, it } from "vitest";
import {
  appendWaiverTemplateParameter,
  renderWaiverTemplate,
  waiverTemplateSrcDoc,
  waiverTemplateParameterGroups,
  inferredWaiverParameterSource,
  waiverTemplateMappingTokens,
} from "../lib/waiver-template";

describe("optional event waiver template parameters", () => {
  it("offers athlete, event and digital signing parameters", () => {
    expect(waiverTemplateParameterGroups.map((group) => group.label)).toEqual([
      "Athlete",
      "Event",
      "Relay team",
      "Digital signing",
      "Organiser",
      "Agreement date",
    ]);
    expect(waiverTemplateParameterGroups.flatMap((group) => group.parameters).map((item) => item.token)).toContain("{{params.name}}");
    expect(waiverTemplateParameterGroups.flatMap((group) => group.parameters).map((item) => item.token)).toContain("{{params.waiver_id}}");
    expect(waiverTemplateParameterGroups.flatMap((group) => group.parameters).map((item) => item.token)).toContain("{{jurisdiction}}");
    expect(waiverTemplateParameterGroups.flatMap((group) => group.parameters).map((item) => item.token)).toContain("{{params.team_name}}");
  });

  it("renders both params tokens and the supplied simple waiver aliases", () => {
    const rendered = renderWaiverTemplate(
      "{{params.name}} · {{name}} · {{eventname}} · {{category}} · {{eventdate}} · {{phone}} · {{emergency_number}} · {{organizer_name}} · {{jurisdiction}} · {{day}} · {{date}}",
      {
        name: "Asha & Rao", event_name: "Ozar Triathlon", race_category: "Olympic", event_date: "4 October 2026",
        mobile: "+91 90000 00000", emergency_contact: "+91 91111 11111", organizer_name: "Race Upshot", jurisdiction: "Pune, Maharashtra", day: "4", date: "4 October 2026",
      },
    );
    expect(rendered).toBe("Asha &amp; Rao · Asha &amp; Rao · Ozar Triathlon · Olympic · 4 October 2026 · +91 90000 00000 · +91 91111 11111 · Race Upshot · Pune, Maharashtra · 4 · 4 October 2026");
  });

  it("lists every standard mapping parameter and infers legacy event aliases", () => {
    const tokens = waiverTemplateMappingTokens("{{jurisdiction}} · {{eventname}} · {{category}} · {{eventdate}}");
    expect(tokens).toContain("signature_name");
    expect(tokens).toContain("signed_at");
    expect(tokens).toContain("jurisdiction");
    expect(tokens).toContain("eventname");
    expect(inferredWaiverParameterSource("eventname")).toBe("event_name");
    expect(inferredWaiverParameterSource("category")).toBe("race_category");
    expect(inferredWaiverParameterSource("eventdate")).toBe("event_date");
  });

  it("keeps organiser address separate from venue/location values", () => {
    const rendered = renderWaiverTemplate("Organiser: {{organizer_address}}", {
      organizer_address: "Neb Sports Pvt Ltd, Udupi, India",
    });
    expect(rendered).toBe("Organiser: Neb Sports Pvt Ltd, Udupi, India");
    expect(rendered).not.toContain("Manthan Beach Resort Kapu");
  });

  it("renders pasted HTML and CSS safely while preserving plain-text line breaks", () => {
    const rendered = waiverTemplateSrcDoc('<style>.title{color:#123456}</style><strong class="title">Agreement</strong>\nName: {{name}}', { name: "<Asha>" });
    expect(rendered).toContain(".title{color:#123456}");
    expect(rendered).toContain("white-space:pre-wrap");
    expect(rendered).toContain("&lt;Asha&gt;");
    expect(rendered).not.toContain("<Asha>");
  });

  it("inserts the selected parameter in bold without requiring existing waiver text", () => {
    expect(appendWaiverTemplateParameter("", "{{params.name}}")).toBe("<strong>{{params.name}}</strong>");
    expect(appendWaiverTemplateParameter("<p>Agreement</p>\n", "{{params.event_name}}"))
      .toBe("<p>Agreement</p>\n<strong>{{params.event_name}}</strong>");
  });
});
