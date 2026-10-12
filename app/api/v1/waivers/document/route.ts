import { getWaiverDocument, verifyWaiverDocumentAccess } from "@/lib/signed-waivers";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const key = url.searchParams.get("key") || "";
  const signature = url.searchParams.get("signature") || "";
  if (!await verifyWaiverDocumentAccess(key, signature)) return new Response("Not found", { status: 404 });
  const object = await getWaiverDocument(key);
  if (!object) return new Response("Not found", { status: 404 });
  return new Response(await object.arrayBuffer(), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": 'inline; filename="signed-waiver.pdf"',
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      etag: object.httpEtag,
    },
  });
}
