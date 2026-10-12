import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  test: {
    exclude: ["**/node_modules/**", "**/.next/**", "**/._*", "app/MOBILE/**", "apps/mobile/**", "packages/live-tracking-contracts/**", "BM WEB APP SRC/**"],
  },
});
