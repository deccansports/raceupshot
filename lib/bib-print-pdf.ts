type DownloadPrintPdfOptions = {
  html: string;
  fileName: string;
  pageWidthMm: number;
  pageHeightMm: number;
  outputMode?: "download" | "open";
  targetWindow?: Window | null;
  onProgress?: (completedPages: number, totalPages: number) => void;
};

const PDF_RASTER_DPI = 300;
const CSS_PIXELS_PER_INCH = 96;
const FOUR_UP_BIB_WIDTH_MM = 210;
const FOUR_UP_BIB_HEIGHT_MM = 148.5;

export function fourUpBibPlacement(index: number): { xMm: number; yMm: number } {
  if (!Number.isInteger(index) || index < 0 || index > 3) throw new Error("A four-up sheet has exactly four BIB positions.");
  return { xMm: (index % 2) * FOUR_UP_BIB_WIDTH_MM, yMm: Math.floor(index / 2) * FOUR_UP_BIB_HEIGHT_MM };
}

function waitForFrameLoad(frame: HTMLIFrameElement): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error("The print preview took too long to load.")), 30_000);
    frame.addEventListener("load", () => { window.clearTimeout(timeout); resolve(); }, { once: true });
    frame.addEventListener("error", () => { window.clearTimeout(timeout); reject(new Error("Could not load the print preview.")); }, { once: true });
  });
}

async function waitForImages(root: ParentNode): Promise<void> {
  await Promise.all(Array.from(root.querySelectorAll<HTMLImageElement>("img")).map(async (image) => {
    if (!image.complete) {
      await new Promise<void>((resolve, reject) => {
        image.addEventListener("load", () => resolve(), { once: true });
        image.addEventListener("error", () => reject(new Error(`Could not load an image used by the print template: ${image.currentSrc || image.src}`)), { once: true });
      });
    }
    if (typeof image.decode === "function") await image.decode().catch(() => undefined);
    if (!image.naturalWidth) throw new Error(`Could not load an image used by the print template: ${image.currentSrc || image.src}`);
  }));
}

function waitForPaint(frameWindow: Window): Promise<void> {
  return new Promise((resolve) => frameWindow.requestAnimationFrame(() => frameWindow.requestAnimationFrame(() => resolve())));
}

function captureFailureMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (typeof error === "string" && error.trim()) return error.trim();
  if (typeof Event !== "undefined" && error instanceof Event) return `${error.type || "render"} event while drawing the print design`;
  return "The browser could not capture the print design.";
}

function cloneWithComputedStyles(source: HTMLElement, sourceWindow: Window): HTMLElement {
  const clone = source.cloneNode(true) as HTMLElement;
  const sourceNodes = [source, ...Array.from(source.querySelectorAll<HTMLElement>("*"))];
  const cloneNodes = [clone, ...Array.from(clone.querySelectorAll<HTMLElement>("*"))];
  for (let index = 0; index < sourceNodes.length; index += 1) {
    const computed = sourceWindow.getComputedStyle(sourceNodes[index]);
    const target = cloneNodes[index];
    if (!target) continue;
    for (const property of Array.from(computed)) target.style.setProperty(property, computed.getPropertyValue(property), computed.getPropertyPriority(property));
  }
  const bounds = source.getBoundingClientRect();
  clone.style.setProperty("position", "relative", "important");
  clone.style.setProperty("left", "0", "important");
  clone.style.setProperty("top", "0", "important");
  clone.style.setProperty("margin", "0", "important");
  clone.style.setProperty("transform", "none", "important");
  clone.style.setProperty("width", `${bounds.width}px`, "important");
  clone.style.setProperty("height", `${bounds.height}px`, "important");
  return clone;
}

function safePdfFileName(fileName: string): string {
  const normalized = fileName.trim().replace(/[^a-z0-9._-]+/gi, "_").replace(/^_+|_+$/g, "");
  return `${normalized || "Race_Upshot_Print"}.pdf`;
}

export async function downloadPrintDocumentPdf(options: DownloadPrintPdfOptions): Promise<void> {
  if (typeof window === "undefined") throw new Error("PDF download is only available in the browser.");

  const frame = document.createElement("iframe");
  const pixelsPerMm = 96 / 25.4;
  frame.title = "Print PDF export";
  frame.setAttribute("aria-hidden", "true");
  frame.style.position = "fixed";
  frame.style.left = "-100000px";
  frame.style.top = "0";
  frame.style.width = `${Math.ceil(options.pageWidthMm * pixelsPerMm) + 4}px`;
  frame.style.height = `${Math.ceil(options.pageHeightMm * pixelsPerMm) + 4}px`;
  frame.style.border = "0";
  frame.style.pointerEvents = "none";

  const loaded = waitForFrameLoad(frame);
  frame.srcdoc = options.html;
  document.body.appendChild(frame);

  try {
    await loaded;
    const frameDocument = frame.contentDocument;
    if (!frameDocument) throw new Error("Could not access the print preview.");

    const exportStyle = frameDocument.createElement("style");
    exportStyle.textContent = "html,body{background:#fff!important}.print-note{display:none!important}.print-page{margin:0!important;box-shadow:none!important}.print-item{outline:none!important}";
    frameDocument.head.appendChild(exportStyle);

    if (frameDocument.fonts?.ready) await frameDocument.fonts.ready;
    await waitForImages(frameDocument);
    if (frame.contentWindow) await waitForPaint(frame.contentWindow);

    const pages = Array.from(frameDocument.querySelectorAll<HTMLElement>(".print-page"));
    if (!pages.length) throw new Error("No printable pages were generated.");

    const [{ toJpeg }, { default: jsPDF }] = await Promise.all([import("html-to-image"), import("jspdf")]);
    const orientation = options.pageWidthMm > options.pageHeightMm ? "landscape" : "portrait";
    const pdf = new jsPDF({ orientation, unit: "mm", format: [options.pageWidthMm, options.pageHeightMm], compress: true, putOnlyUsedFonts: true });

    async function capture(element: HTMLElement, pageNumber: number): Promise<string> {
      const bounds = element.getBoundingClientRect();
      if (bounds.width < 1 || bounds.height < 1) throw new Error("The printable page has no visible size. Refresh the page and try again.");
      const primaryOptions = { backgroundColor: "#ffffff", cacheBust: false, pixelRatio: PDF_RASTER_DPI / CSS_PIXELS_PER_INCH, quality: 0.94, width: Math.ceil(bounds.width), height: Math.ceil(bounds.height), fontEmbedCSS: "" } as const;
      try {
        return await toJpeg(element, primaryOptions);
      } catch (firstError) {
        try {
          const sourceWindow = element.ownerDocument.defaultView;
          if (!sourceWindow) throw firstError;
          const captureHost = document.createElement("div");
          captureHost.setAttribute("aria-hidden", "true");
          captureHost.style.cssText = `position:fixed;left:-100000px;top:0;width:${Math.ceil(bounds.width)}px;height:${Math.ceil(bounds.height)}px;overflow:hidden;background:#fff;pointer-events:none`;
          const clone = cloneWithComputedStyles(element, sourceWindow);
          captureHost.appendChild(clone);
          document.body.appendChild(captureHost);
          try {
            await waitForImages(captureHost);
            await waitForPaint(window);
            return await toJpeg(clone, { ...primaryOptions, pixelRatio: 2, quality: 0.92, skipFonts: true });
          } finally {
            captureHost.remove();
          }
        } catch (retryError) {
          throw new Error(`Could not capture print page ${pageNumber}: ${captureFailureMessage(retryError)}. Initial capture: ${captureFailureMessage(firstError)}.`);
        }
      }
    }

    for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
      const page = pages[pageIndex];
      if (pageIndex > 0) pdf.addPage([options.pageWidthMm, options.pageHeightMm], orientation);
      if (page.classList.contains("four-up")) {
        const bibs = Array.from(page.querySelectorAll<HTMLElement>(".print-item"));
        if (bibs.length !== 4 || options.pageWidthMm < 420 || options.pageHeightMm < 297) throw new Error("The four-up BIB sheet has invalid slots or paper dimensions.");
        pdf.setFillColor(255, 255, 255);
        pdf.rect(0, 0, options.pageWidthMm, options.pageHeightMm, "F");
        for (const [index, bib] of bibs.entries()) {
          if (bib.classList.contains("blank")) continue;
          const image = await capture(bib, pageIndex + 1);
          const { xMm, yMm } = fourUpBibPlacement(index);
          pdf.addImage(image, "JPEG", xMm, yMm, FOUR_UP_BIB_WIDTH_MM, FOUR_UP_BIB_HEIGHT_MM, undefined, "FAST");
        }
      } else {
        const image = await capture(page, pageIndex + 1);
        pdf.addImage(image, "JPEG", 0, 0, options.pageWidthMm, options.pageHeightMm, undefined, "FAST");
      }
      options.onProgress?.(pageIndex + 1, pages.length);
    }

    if (options.outputMode === "open") {
      if (!options.targetWindow || options.targetWindow.closed) throw new Error("The PDF preview window was closed. Allow popups and try again.");
      const objectUrl = URL.createObjectURL(pdf.output("blob"));
      options.targetWindow.location.replace(objectUrl);
      options.targetWindow.focus();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 10 * 60_000);
    } else {
      pdf.save(safePdfFileName(options.fileName));
    }
  } finally {
    frame.remove();
  }
}
