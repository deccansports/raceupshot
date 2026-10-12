import { rename, rm } from "node:fs/promises";
import { resolve } from "node:path";

const devCache = resolve(".next-dev");
const staleCache = resolve(`.next-dev-stale-${process.pid}-${Date.now()}`);

try {
  // Rename first so Next.js can create a clean cache even when macOS metadata
  // files are recreated asynchronously on an external volume during removal.
  await rename(devCache, staleCache);
} catch (error) {
  if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) {
    throw error;
  }
}

for (let attempt = 0; attempt < 5; attempt += 1) {
  try {
    await rm(staleCache, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    break;
  } catch (error) {
    const retryable = error && typeof error === "object" && "code" in error
      && ["ENOTEMPTY", "EBUSY", "EPERM"].includes(String(error.code));
    if (!retryable || attempt === 4) {
      // The renamed cache is disconnected from Next.js. Leaving a stale cache
      // tombstone is safer than preventing the development server from starting.
      console.warn("Next.js cache was detached but could not be fully removed yet.", error);
      break;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100 * 2 ** attempt));
  }
}

console.log("Cleared the Next.js development cache.");
