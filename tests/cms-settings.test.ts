import { describe, expect, it } from "vitest";
import { defaultCmsSiteSettings } from "../lib/cms";
import { cmsSiteSettingsSchema } from "../lib/cms-schema";

describe("CMS site settings", () => {
  it("accepts the default login media and footer configuration", () => {
    expect(cmsSiteSettingsSchema.safeParse(defaultCmsSiteSettings).success).toBe(true);
  });

  it("keeps login media actions and the requested footer sections available", () => {
    expect(defaultCmsSiteSettings.loginMedia.every((item) => item.src && item.enabled)).toBe(true);
    expect(defaultCmsSiteSettings.footer.columns.map((column) => column.title)).toEqual([
      "Explore",
      "Company",
      "Races",
      "Legal",
    ]);
  });
});
