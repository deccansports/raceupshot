import { describe, expect, it } from "vitest";
import { bibPrintCategoryOptions } from "../lib/bib-print-category-options";

describe("BIB print category options", () => {
  it("shows each category once when configuration and roster use different IDs", () => {
    const event = {
      tickets: [{ id: "configured-tri", name: "Triathlon 113" }, { id: "configured-oly", name: "Olympic Triathlon" }],
      ticketDefinitions: [{ id: "configured-tri", name: "Triathlon 113" }, { id: "configured-oly", name: "Olympic Triathlon" }],
    };
    const participants = [
      { ticketId: "roster-tri", ticketName: "Triathlon 113" },
      { ticketId: "roster-tri", ticketName: "Triathlon 113" },
      { ticketId: "roster-oly", ticketName: "Olympic Triathlon" },
    ];
    expect(bibPrintCategoryOptions(event, participants)).toEqual([
      ["roster-tri", "Triathlon 113"],
      ["roster-oly", "Olympic Triathlon"],
    ]);
  });

  it("matches category names despite case and whitespace differences", () => {
    expect(bibPrintCategoryOptions(
      { tickets: [{ id: "configured", name: "Sprint Triathlon" }] },
      [{ ticketId: "roster", ticketName: " sprint  TRIATHLON " }],
    )).toEqual([["roster", "sprint TRIATHLON"]]);
  });

  it("removes duplicated configured categories containing invisible import characters", () => {
    const names = ["Triathlon 113", "Duathlon 111", "Duathlon 50", "Triathlon 113 Relay", "Olympic Triathlon", "Sprint Triathlon"];
    expect(bibPrintCategoryOptions({
      tickets: names.map((name, index) => ({ id: `ticket-${index}`, name })),
      ticketDefinitions: names.map((name, index) => ({ id: `definition-${index}`, name: `${name}\u200B` })),
    }, [])).toEqual(names.map((name, index) => [`ticket-${index}`, name]));
  });

  it("normalizes non-breaking spaces and byte-order marks in roster category names", () => {
    expect(bibPrintCategoryOptions(
      { tickets: [{ id: "configured", name: "Olympic Triathlon" }] },
      [{ ticketId: "roster", ticketName: "\uFEFFOlympic\u00A0Triathlon" }],
    )).toEqual([["roster", "Olympic Triathlon"]]);
  });

  it("keeps genuinely different roster ticket IDs selectable and distinct", () => {
    expect(bibPrintCategoryOptions(
      { tickets: [{ id: "configured", name: "Triathlon" }] },
      [{ ticketId: "wave-a", ticketName: "Triathlon" }, { ticketId: "wave-b", ticketName: "Triathlon" }],
    )).toEqual([["wave-a", "Triathlon · wave-a"], ["wave-b", "Triathlon · wave-b"]]);
  });

  it("falls back to event categories and does not repeat a roster ticket with the same ID", () => {
    expect(bibPrintCategoryOptions(
      { categories: ["Duathlon 50"] },
      [{ ticketId: "duathlon-50", ticketName: "Duathlon 50" }],
    )).toEqual([["duathlon-50", "Duathlon 50"]]);
  });
});
