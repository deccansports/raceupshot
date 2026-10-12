import { getPlatformEvent } from "@/lib/platform-repository";
import { getEventGuidebookData } from "@/lib/raceupshot-repository";

export const dynamic = "force-dynamic";

const DATA_IMAGE = /^data:(image\/(?:png|jpe?g|webp));base64,([A-Za-z0-9+/=\s]+)$/;
const DATA_PDF = /^data:application\/pdf;base64,([A-Za-z0-9+/=\s]+)$/;

function decodeBase64(value: string): ArrayBuffer {
  const binary = atob(value.replace(/\s+/g, ""));
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return buffer;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ eventId: string; kind: string }> },
) {
  const { eventId, kind } = await params;
  if (kind !== "banner" && kind !== "logo" && kind !== "guidebook") return new Response("Media not found", { status: 404 });

  const event = await getPlatformEvent(eventId);
  if (kind === "guidebook") {
    if (!event?.athleteGuidebookUrl) return new Response("Media not found", { status: 404 });
    if (/^https?:\/\//i.test(event.athleteGuidebookUrl)) return Response.redirect(event.athleteGuidebookUrl, 302);
    const data = await getEventGuidebookData(event.eventId);
    const match = data?.match(DATA_PDF);
    if (!match) return new Response("Guidebook not found", { status: 404 });
    try {
      return new Response(decodeBase64(match[1]), {
        headers: {
          "content-type": "application/pdf",
          "content-disposition": `inline; filename="${event.slug}-athlete-guidebook.pdf"`,
          "cache-control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
          "x-content-type-options": "nosniff",
        },
      });
    } catch {
      return new Response("Invalid guidebook", { status: 422 });
    }
  }
  const source = kind === "banner" ? event?.bannerUrl : event?.logoUrl;
  if (!source) return new Response("Media not found", { status: 404 });
  if (/^https?:\/\//i.test(source)) return Response.redirect(source, 302);

  const match = source.match(DATA_IMAGE);
  if (!match) return new Response("Unsupported event media", { status: 415 });
  try {
    return new Response(decodeBase64(match[2]), {
      headers: {
        "content-type": match[1],
        "cache-control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return new Response("Invalid event media", { status: 422 });
  }
}
