import { describe, expect, it } from "vitest";
import {
  inferResultCategoryMapping,
  resultCategorySourceGroups,
  suggestResultCategory,
} from "../lib/result-category-mapping";

const targets = [
  "BERGMAN 102 TRIATHLON",
  "BERGMAN OLYMPIC TRIATHLON",
  "BERGMAN SWIMATHON - 500 MTRS, 1 KM ,2KM ,4KM",
];

describe("result ticket and contest mapping", () => {
  it("matches event ticket names despite spacing and unit differences", () => {
    expect(suggestResultCategory("Bergman 102 Triathlon", targets)).toBe(targets[0]);
    expect(suggestResultCategory("OLYMPIC", targets)).toBe(targets[1]);
    expect(suggestResultCategory("4 KM", targets)).toBe(targets[2]);
    expect(suggestResultCategory("Bergman Swimathon - 1 Km", targets)).toBe(targets[2]);
    expect(suggestResultCategory("BERGMAN SWIMATHON - 2 KM", targets)).toBe(targets[2]);
    expect(suggestResultCategory("Bergman Swimathon - 4 Km", targets)).toBe(targets[2]);
    expect(suggestResultCategory("Bergman Swimathon - Kids 500 Mtrs", targets)).toBe(targets[2]);
  });

  it("does not guess when a generic value matches multiple tickets", () => {
    expect(suggestResultCategory("Triathlon", targets)).toBe("");
  });

  it("prefers a ticket column that maps every row in one combined sheet", () => {
    const rows = [
      { "Ticket Name": "BERGMAN 102 TRIATHLON", __sheet: "All Results" },
      { "Ticket Name": "BERGMAN OLYMPIC TRIATHLON", __sheet: "All Results" },
      { "Ticket Name": "4 KM", __sheet: "All Results" },
    ];
    const inferred = inferResultCategoryMapping(rows, ["Ticket Name", "__sheet"], targets);
    expect(inferred.column).toBe("Ticket Name");
    expect(inferred.mappedRows).toBe(3);
    expect(inferred.unmatchedRows).toBe(0);
  });

  it("uses worksheet names when a workbook has one contest per sheet", () => {
    const rows = [
      { Bib: "101", __sheet: "BERGMAN 102 TRIATHLON" },
      { Bib: "201", __sheet: "BERGMAN OLYMPIC TRIATHLON" },
      { Bib: "301", __sheet: "4 KM" },
    ];
    const inferred = inferResultCategoryMapping(rows, ["Bib", "__sheet"], targets);
    expect(inferred.column).toBe("__sheet");
    expect(inferred.mappedRows).toBe(3);
    expect(inferred.mappings["4 KM"]).toBe(targets[2]);
  });

  it("maps row-level Swimathon distances into the combined Swimathon ticket", () => {
    const rows = [
      { Category: "Bergman Swimathon - Kids 500 Mtrs", __sheet: "All Results" },
      { Category: "Bergman Swimathon - 1 Km", __sheet: "All Results" },
      { Category: "BERGMAN SWIMATHON - 2 KM", __sheet: "All Results" },
      { Category: "Bergman Swimathon - 4 Km", __sheet: "All Results" },
    ];
    const inferred = inferResultCategoryMapping(rows, ["Category", "__sheet"], targets);
    expect(inferred.column).toBe("Category");
    expect(inferred.mappedRows).toBe(4);
    expect(inferred.unmatchedRows).toBe(0);
    expect(Object.values(inferred.mappings)).toEqual([
      targets[2],
      targets[2],
      targets[2],
      targets[2],
    ]);
  });

  it("combines source labels that differ only by case or unit formatting", () => {
    const groups = resultCategorySourceGroups([
      { Category: "Bergman 102 Triathlon" },
      { Category: "BERGMAN 102 TRIATHLON" },
      { Category: "Bergman Swimathon - 1 Km" },
      { Category: "BERGMAN SWIMATHON - 1 KM" },
    ], "Category");

    expect(groups).toHaveLength(2);
    expect(groups.map((group) => group.count).sort((left, right) => left - right)).toEqual([2, 2]);
    expect(groups.every((group) => group.sources.length === 2)).toBe(true);
  });
});
