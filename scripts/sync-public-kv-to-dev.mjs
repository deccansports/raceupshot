import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const namespaceId = "5b3d551f610040fea615e8e2485c3a28";
const configPath = "wrangler.next-dev.jsonc";
const persistPath = ".wrangler/state/v3";
const prefixes = [
  "raceupshot:events:index",
  "raceupshot:event:",
  "raceupshot:homepage-slider:",
  "raceupshot:cms:site-settings",
  "raceupshot:course-maps:event:",
  "raceupshot:live:event:",
];
const batchSize = 100;
const wrangler = resolve("node_modules/wrangler/bin/wrangler.js");

function runWrangler(args) {
  const result = spawnSync(process.execPath, [wrangler, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `Wrangler exited with ${result.status}`);
  }
  return result.stdout;
}

function parseJson(output) {
  const objectStart = output.indexOf("{");
  const arrayStart = output.indexOf("[");
  const starts = [objectStart, arrayStart].filter((index) => index >= 0);
  if (!starts.length) throw new Error(`Wrangler did not return JSON:\n${output}`);
  return JSON.parse(output.slice(Math.min(...starts)));
}

const workDir = await mkdtemp(join(tmpdir(), "raceupshot-kv-sync-"));

try {
  console.log("Reading public Race Upshot keys from Cloudflare KV...");
  const keys = new Set();
  for (const prefix of prefixes) {
    const rows = parseJson(runWrangler([
      "kv", "key", "list",
      "--namespace-id", namespaceId,
      "--remote",
      "--prefix", prefix,
    ]));
    for (const row of rows) keys.add(row.name);
  }

  const names = [...keys].sort();
  console.log(`Downloading ${names.length} public keys...`);
  const entries = [];
  for (let offset = 0; offset < names.length; offset += batchSize) {
    const batch = names.slice(offset, offset + batchSize);
    const keysFile = join(workDir, `keys-${offset}.json`);
    await writeFile(keysFile, JSON.stringify(batch));
    const values = parseJson(runWrangler([
      "kv", "bulk", "get", keysFile,
      "--namespace-id", namespaceId,
      "--remote",
    ]));
    entries.push(...Object.entries(values).map(([key, value]) => ({ key, value })));
    console.log(`Downloaded ${Math.min(offset + batch.length, names.length)}/${names.length}`);
  }

  const valuesFile = join(workDir, "public-kv.json");
  await writeFile(valuesFile, JSON.stringify(entries));
  runWrangler([
    "kv", "bulk", "put", valuesFile,
    "--binding", "RACEUPSHOT",
    "--local",
    "--config", configPath,
    "--persist-to", persistPath,
  ]);
  console.log(`Synced ${entries.length} public keys to local development KV.`);
} finally {
  await rm(workDir, { recursive: true, force: true });
}
