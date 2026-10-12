import { getCloudflareContext } from "@opennextjs/cloudflare";

export const dynamic = "force-dynamic";

const publicCorsHeaders = { "access-control-allow-origin": "*" };

export function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      ...publicCorsHeaders,
      "access-control-allow-methods": "GET, OPTIONS",
      "access-control-allow-headers": "accept, authorization",
      "access-control-max-age": "86400",
    },
  });
}

export async function GET(_request: Request, { params }: { params: Promise<{ eventId: string; assetId: string }> }) {
  const { eventId, assetId } = await params;
  if (!/^[a-zA-Z0-9-]{1,200}$/.test(eventId) || !/^[a-f0-9-]{36}\.(?:jpg|png|webp|svg)$/.test(assetId)) {
    return new Response("Not found", { status: 404, headers: publicCorsHeaders });
  }
  const { env } = await getCloudflareContext({ async: true });
  if (!env.EVENT_MEDIA) return new Response("Media storage is unavailable", { status: 503, headers: publicCorsHeaders });
  const object = await env.EVENT_MEDIA.get(`event-partners/${eventId}/${assetId}`);
  if (!object) return new Response("Not found", { status: 404, headers: publicCorsHeaders });
  const headers = new Headers();
  object.writeHttpMetadata(headers as unknown as import("@cloudflare/workers-types").Headers);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", "public, max-age=31536000, immutable");
  headers.set("access-control-allow-origin", "*");
  return new Response(object.body as unknown as BodyInit, { headers });
}
