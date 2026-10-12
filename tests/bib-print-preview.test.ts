import { describe, expect, it } from "vitest";
import { defaultPrintTemplate } from "../lib/bib-print-layout";
import { fitTextBoxToContent, printPreviewScale } from "../lib/bib-print-preview";

describe("BIB print canvas sizing", () => {
  it("uses the physical print pixel size instead of halving or capping large fonts", () => {
    const sixInchesMm = 152.4;
    expect(printPreviewScale(576, sixInchesMm)).toBeCloseTo(1);
    expect(98 * printPreviewScale(760, sixInchesMm)).toBeGreaterThan(98);
    expect(300 * printPreviewScale(760, sixInchesMm)).toBeGreaterThan(300);
  });

  it("expands a text box around its centre to fit a large BIB number", () => {
    const element = defaultPrintTemplate("event", "ticket", "BIB").elements[0];
    element.fontSize = 98;
    const fitted = fitTextBoxToContent(element, 340, 1, 152.4, 101.6);
    expect(fitted.width).toBeGreaterThan(60);
    expect(fitted.height).toBeGreaterThan(26);
    expect(fitted.x + fitted.width).toBeLessThanOrEqual(100);
    expect(fitted.y + fitted.height).toBeLessThanOrEqual(100);
  });
});
