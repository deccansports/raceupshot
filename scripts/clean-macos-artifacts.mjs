import { readdir, unlink } from "node:fs/promises";
import { resolve } from "node:path";

const roots = [
  "app",
  "components",
  "lib",
  "packages",
  "public",
  "tests",
  "apps/mobile/app",
  "apps/mobile/src",
  ".next",
  ".next-dev",
  ".open-next",
];

let removed = 0;

async function clean(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }

  await Promise.all(entries.map(async (entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isFile() && (entry.name.startsWith("._") || entry.name.startsWith(".__"))) {
      try {
        await unlink(path);
        removed += 1;
      } catch (error) {
        // A running dev/build process can replace a generated directory after
        // readdir and before unlink. Treat an already-removed metadata file as
        // successfully cleaned instead of failing the production build.
        if (error?.code !== "ENOENT") throw error;
      }
      return;
    }
    if (entry.isDirectory()) await clean(path);
  }));
}

await Promise.all(roots.map((root) => clean(resolve(root))));
console.log(`Removed ${removed} macOS metadata artifact${removed === 1 ? "" : "s"}.`);
