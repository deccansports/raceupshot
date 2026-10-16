import { getCloudflareContext } from "@opennextjs/cloudflare";
export const dynamic = "force-dynamic";
export async function GET(_request: Request, { params }: { params: Promise<{ assetId: string }> }) {
  const { assetId } = await params;
  const match = assetId.match(/^[a-f0-9-]{36}\.(jpg|png|webp|pdf)$/);
  if (!match) return new Response("Not found", { status: 404 });
  const { env } = await getCloudflareContext({ async: true });
  const object = await env.EVENT_MEDIA?.get(`whatsapp-campaign-media/${assetId}`);
  if (!object) return new Response("Not found", { status: 404 });
  const contentType = ({ jpg: "image/jpeg", png: "image/png", webp: "image/webp", pdf: "application/pdf" } as const)[match[1] as "jpg" | "png" | "webp" | "pdf"];
  return new Response(await object.arrayBuffer(), { headers: { "content-type": contentType, etag: object.httpEtag, "cache-control": "public, max-age=31536000, immutable", "content-disposition": "inline" } });
}
