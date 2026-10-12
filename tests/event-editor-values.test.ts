import { describe, expect, it } from "vitest";
import { eventEditorDate, eventEditorTime } from "../lib/event-editor-values";

describe("event editor date and time values", () => {
  it("converts a 12-hour display time into the value required by a time input", () => {
    expect(eventEditorTime("06:00 am", "2026-07-30T00:30:00.000Z")).toBe("06:00");
    expect(eventEditorTime("06:45 pm", "2026-07-30T13:15:00.000Z")).toBe("18:45");
    expect(eventEditorTime("12:15 am", "2026-07-29T18:45:00.000Z")).toBe("00:15");
  });

  it("uses the stored timestamp when no display time is available", () => {
    expect(eventEditorTime("", "2026-07-30T00:30:00.000Z")).toBe("06:00");
  });

  it("keeps the event date in the event timezone", () => {
    expect(eventEditorDate("2026-07-29T18:30:00.000Z")).toBe("2026-07-30");
  });
});
