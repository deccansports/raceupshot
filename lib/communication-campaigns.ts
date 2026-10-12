import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { KVNamespace } from "@cloudflare/workers-types";
import type { CommunicationCampaign } from "./communications";

const PREFIX = "raceupshot";

export async function listCommunicationCampaigns(): Promise<CommunicationCampaign[]> {
  const { env } = await getCloudflareContext({ async: true });
  const kv = env.RACEUPSHOT as KVNamespace;
  const ids = (await kv.get<string[]>(`${PREFIX}:communications:index`, "json")) ?? [];
  const rows = await Promise.all(ids.map((id) =>
    kv.get<CommunicationCampaign>(`${PREFIX}:communication:${id}`, "json")));
  return rows.filter((row): row is CommunicationCampaign => Boolean(row));
}
