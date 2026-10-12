import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

// This bridge is only needed by `next dev`. Starting a remote Wrangler proxy
// during `next build` makes compilation depend on an interactive Cloudflare
// session and prevents reproducible CI builds.
if (process.env.NODE_ENV === "development") {
  void initOpenNextCloudflareForDev({
    // Development uses a local KV mirror because Cloudflare edge-preview
    // sessions can hang or expire. Refresh it with `npm run kv:sync:dev`.
    configPath: "wrangler.next-dev.jsonc",
    persist: { path: ".wrangler/state/v3" },
    remoteBindings: false,
  });
}

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["@race-technology/timing-calculations"],
  experimental: process.env.NEXT_BUILD_CPUS ? { cpus: Math.max(1, Number(process.env.NEXT_BUILD_CPUS) || 1) } : undefined,
  // Keep the development module graph isolated from production/OpenNext
  // builds. Sharing `.next` lets a build replace Webpack chunks underneath a
  // running `next dev` browser and causes opaque errors such as
  // "Cannot read properties of undefined (reading 'call')".
  distDir: process.env.NEXT_DIST_DIR?.trim() || (process.env.NODE_ENV === "development" ? ".next-dev" : ".next"),
  images: { unoptimized: true },
  webpack(config) {
    // The vendored ESM timing package publishes TypeScript source and uses
    // NodeNext-compatible runtime specifiers such as `./types.js`. TypeScript
    // resolves those specifiers to `types.ts`, but Webpack needs the equivalent
    // extension mapping while compiling the package for Next.js.
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
  async headers() {
    const mobileCorsHeaders = [
        { key: "Access-Control-Allow-Origin", value: "*" },
        { key: "Access-Control-Allow-Methods", value: "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS" },
        { key: "Access-Control-Allow-Headers", value: "Accept, Authorization, Content-Type" },
        { key: "Access-Control-Max-Age", value: "86400" },
    ];
    return [
      { source: "/api/v1/:path*", headers: mobileCorsHeaders },
      { source: "/api/auth/otp/:path*", headers: mobileCorsHeaders },
    ];
  },
};

export default nextConfig;
