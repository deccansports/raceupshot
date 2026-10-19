import { describe, expect, it } from "vitest";
import { athleteBand, finishLineChipTime, rollFinishers } from "@/components/finish-line-led-display";
import { FinishLineLedDisplay, latestVisibleFinishers } from "@/components/finish-line-led-display";
import { DEFAULT_LED_FIELDS, normalizeLedFields, moveLedField, type LedField } from "@/lib/finish-line-led-fields";
import type { FinishLineLedFeed, FinishLineLedFinisher } from "@/lib/finish-line-led";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

describe("finish-line athlete group", () => {
  it("separates gender and age group for the LED display", () => {
    expect(athleteBand({ gender: "female", ageGroup: "under-30" })).toBe("F - UNDER 30");
    expect(athleteBand({ gender: "male", ageGroup: "under-30" })).toBe("M - UNDER 30");
  });

  it("does not add a separator when only one value exists", () => {
    expect(athleteBand({ gender: "", ageGroup: "40-44" })).toBe("40-44");
    expect(athleteBand({ gender: "", ageGroup: "" })).toBe("OPEN");
  });
});

describe("finish-line chip time", () => {
  it("shows hours, minutes and seconds without milliseconds", () => {
    expect(finishLineChipTime("03:09:52.000")).toBe("03:09:52");
    expect(finishLineChipTime("3:37:35.750")).toBe("03:37:35");
    expect(finishLineChipTime("02:49:54")).toBe("02:49:54");
  });

  it("preserves unavailable values", () => {
    expect(finishLineChipTime("—")).toBe("—");
  });
});

describe("rolling finishers", () => {
  it("keeps only the latest three visible through repeated polls without replaying history", () => {
    let previous = ["4", "3", "2", "1"].map((id) => ({ id }));
    for (let poll = 0; poll < 100; poll++) {
      previous = rollFinishers(previous, [...previous].reverse()).finishers;
      expect(latestVisibleFinishers(previous).map((row) => row.id)).toEqual(["4", "3", "2"]);
    }
    const next = rollFinishers(previous, [{ id: "5" }, ...previous]);
    expect(latestVisibleFinishers(next.finishers).map((row) => row.id)).toEqual(["5", "4", "3"]);
  });

  it("does not display a duplicate athlete twice", () => {
    const incoming = [{ id: "3" }, { id: "3" }, { id: "2" }, { id: "1" }];
    expect(rollFinishers([], incoming).newIds).toEqual(["3", "2", "1"]);
    expect(latestVisibleFinishers(incoming).map((row) => row.id)).toEqual(["3", "2", "1"]);
  });
  it("puts each newly finished athlete above the existing athletes", () => {
    const previous = [{ id: "second", name: "Second" }, { id: "first", name: "First" }];
    const incoming = [{ id: "third", name: "Third" }, { id: "first", name: "First updated" }, { id: "second", name: "Second" }];
    const rolled = rollFinishers(previous, incoming);
    expect(rolled.newIds).toEqual(["third"]);
    expect(rolled.finishers.map((row) => row.id)).toEqual(["third", "second", "first"]);
    expect(rolled.finishers[2].name).toBe("First updated");
  });

  it("does not reshuffle athletes on a poll with no new finishers", () => {
    const previous = [{ id: "third" }, { id: "second" }, { id: "first" }];
    const incoming = [{ id: "first" }, { id: "second" }, { id: "third" }];
    expect(rollFinishers(previous, incoming)).toEqual({ finishers: previous, newIds: [] });
  });
});

describe("LED field selection", () => {
  it("reorders selected fields in both directions without changing the original selection", () => {
    const fields: LedField[] = ["bib", "name", "flag", "gender"];
    expect(moveLedField(fields, "gender", "bib")).toEqual(["gender", "bib", "name", "flag"]);
    expect(moveLedField(fields, "bib", "flag")).toEqual(["name", "flag", "bib", "gender"]);
    expect(moveLedField(fields, "country", "bib")).toEqual(fields);
    expect(moveLedField(fields, "name", "name")).toEqual(fields);
    expect(fields).toEqual(["bib", "name", "flag", "gender"]);
    expect(normalizeLedFields(moveLedField(fields, "gender", "bib"))).toEqual(["gender", "bib", "name", "flag"]);
  });
  it("defaults legacy settings safely and never permits rank", () => {
    expect(normalizeLedFields(undefined)).toEqual(DEFAULT_LED_FIELDS);
    expect(normalizeLedFields([])).toEqual(DEFAULT_LED_FIELDS);
    expect(normalizeLedFields(["rank", "bib", "bib", "name"])).toEqual(["bib", "name"]);
  });

  it("renders only selected fields and three finishers, with no place or rank", () => {
    const finishers: FinishLineLedFinisher[] = ["4", "3", "2", "1"].map((id) => ({
      id, bib: `100${id}`, name: `Runner ${id}`, rank: 99, finishTime: "02:34:53",
      category: "Triathlon", country: "IND", gender: "male", ageGroup: "18-35",
      status: "FINISHED", finishedAt: null, visibility: "PUBLIC",
    }));
    const feed: FinishLineLedFeed = {
      event: { id: "test", slug: "test", name: "Test", location: "Test", status: "LIVE" },
      display: { logos: [], idleRotationSeconds: 6, finisherRotationSeconds: 3, visibleFields: ["bib", "name"] },
      finishers, updatedAt: null, source: "live:event:results",
    };
    const html = renderToStaticMarkup(createElement(FinishLineLedDisplay, { initialFeed: feed }));
    expect(html.match(/data-finisher-id=/g)).toHaveLength(3);
    expect(html).toContain("Runner 4");
    expect(html).not.toContain("Runner 1");
    expect(html).not.toContain("PLACE");
    expect(html).not.toContain(">99<");
    expect(html).not.toContain("02:34:53");
    expect(html).not.toContain("18-35");
    expect(html).not.toContain("finish-led-pages");
    expect(html).not.toContain("OFFICIAL LIVE RESULTS");
    expect(html).not.toContain("FINISHERS");
    expect(html).not.toContain("FINISH LINE");
    expect(html).not.toContain("LIVE FINISHES");
    expect(html).not.toContain("RACE UPSHOT");
    expect(html).not.toContain("finish-led-brand");
    expect(html).not.toContain("finish-led-results-title");
    expect(html).toContain('aria-label="Open full screen"');
    const genderHtml = renderToStaticMarkup(createElement(FinishLineLedDisplay, { initialFeed: {
      ...feed, display: { ...feed.display, visibleFields: ["gender", "bib"] },
      finishers: [{ ...finishers[0], gender: " female " }],
    } }));
    expect(genderHtml).toContain(">FEMALE<");
    expect(genderHtml).not.toContain("> female <");
    expect(genderHtml.indexOf(">FEMALE<")).toBeLessThan(genderHtml.indexOf(">1004<"));
  });
});
