import { getCloudflareContext } from "@opennextjs/cloudflare";
import { requireAdmin } from "@/lib/admin-guard";
import { apiFailure, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const imageTypes = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/svg+xml", "svg"],
]);

export async function POST(request: Request, { params }: { params: Promise<{ eventId: string }> }) {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    const { eventId } = await params;
    if (!eventId || !/^[a-zA-Z0-9-]{1,200}$/.test(eventId)) return apiFailure("Invalid event ID.", 400);
    const form = await request.formData();
    const file = form.get("logo");
    if (!(file instanceof File)) return apiFailure("Choose a logo file to upload.", 400);
    const extension = imageTypes.get(file.type);
    if (!extension) return apiFailure("Use a PNG, JPG, WebP or SVG logo.", 400);
    if (!file.size || file.size > MAX_LOGO_BYTES) return apiFailure("Logo must be smaller than 2 MB.", 400);
    const { env } = await getCloudflareContext({ async: true });
    if (!env.EVENT_MEDIA) return apiFailure("Event media storage is unavailable.", 503);
    const assetId = `${crypto.randomUUID()}.${extension}`;
    const key = `event-partners/${eventId}/${assetId}`;
    await env.EVENT_MEDIA.put(key, await file.arrayBuffer(), {
      httpMetadata: { contentType: file.type, cacheControl: "public, max-age=31536000, immutable" },
      customMetadata: { eventId, originalName: file.name.slice(0, 200) },
    });
    const origin = new URL(request.url).origin;
    const logoUrl = `${origin}/api/events/${encodeURIComponent(eventId)}/sponsors/media/${assetId}`;
    return apiSuccess({ logoUrl }, { status: 201, headers: { "cache-control": "no-store" } });
  } catch (error) {
    return apiFailure(error instanceof Error ? error.message : "Unable to upload partner logo.", 500);
  }
}
