import { describe, expect, it } from "vitest";
import { resolveLedLogos } from "@/lib/finish-line-led-logos";
import type { FinishLineLedLogo } from "@/lib/finish-line-led";

const sponsor: FinishLineLedLogo = { id: "partner:1", name: "Event sponsor", logoUrl: "/sponsor.png", kind: "SPONSOR" };
const event: FinishLineLedLogo = { id: "event:1", name: "Event", logoUrl: "/event.png", kind: "EVENT" };
const custom: FinishLineLedLogo = { id: "custom:1", name: "Custom", logoUrl: "/custom.png", kind: "SPONSOR" };

describe("LED event sponsor sync", () => {
  it("includes event and registration sponsor logos even when the saved list was empty", () => {
    expect(resolveLedLogos([event, sponsor], [])).toEqual([event, sponsor]);
  });
  it("uses current source images and keeps custom LED uploads", () => {
    const updated = { ...sponsor, logoUrl: "/new-sponsor.png" };
    expect(resolveLedLogos([updated], [sponsor, custom])).toEqual([updated, custom]);
  });
  it("does not retain deleted source logos or duplicate identical images", () => {
    expect(resolveLedLogos([], [sponsor, event, custom])).toEqual([custom]);
    expect(resolveLedLogos([sponsor, { ...sponsor, id: "partner:2" }], [sponsor])).toEqual([sponsor]);
  });
  it("respects manual selections, while keeping selected logos up to date", () => {
    expect(resolveLedLogos([event, sponsor], [], false)).toEqual([]);
    expect(resolveLedLogos([event, sponsor], [sponsor, custom], false)).toEqual([sponsor, custom]);
  });
});
