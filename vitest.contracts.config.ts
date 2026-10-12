import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/live-tracking-contracts/src/canonical-change.test.ts"],
    exclude: ["**/node_modules/**"],
  },
});
