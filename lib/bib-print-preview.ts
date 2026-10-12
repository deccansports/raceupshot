import type { PrintTemplateElement } from "./bib-print-layout";

const CSS_PIXELS_PER_MM = 96 / 25.4;

/** The PDF uses CSS px on a physical-size page; scale that same px size into the editor canvas. */
export function printPreviewScale(canvasWidthPx: number, itemWidthMm: number): number {
  if (canvasWidthPx <= 0 || itemWidthMm <= 0) return 1;
  return canvasWidthPx / (itemWidthMm * CSS_PIXELS_PER_MM);
}

export function fitTextBoxToContent(
  element: PrintTemplateElement,
  textWidthPx: number,
  lineCount: number,
  itemWidthMm: number,
  itemHeightMm: number,
): Pick<PrintTemplateElement, "x" | "y" | "width" | "height"> {
  const pageWidthPx = itemWidthMm * CSS_PIXELS_PER_MM;
  const pageHeightPx = itemHeightMm * CSS_PIXELS_PER_MM;
  const width = Math.min(100, Math.max(1, (textWidthPx + 12) / pageWidthPx * 100));
  const height = Math.min(100, Math.max(1, (Math.max(1, lineCount) * element.fontSize * (element.lineHeight ?? 1.05) + 8) / pageHeightPx * 100));
  return {
    x: Math.max(0, Math.min(100 - width, element.x + (element.width - width) / 2)),
    y: Math.max(0, Math.min(100 - height, element.y + (element.height - height) / 2)),
    width,
    height,
  };
}
