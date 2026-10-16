import { getCloudflareContext } from "@opennextjs/cloudflare";
import { requireAdmin } from "@/lib/admin-guard";
import { apiFailure, apiSuccess } from "@/lib/api-response";

const types = new Map([["image/jpeg", "jpg"], ["image/png", "png"], ["image/webp", "webp"], ["application/pdf", "pdf"]]);
export async function POST(request: Request) {
  const denied = await requireAdmin(); if (denied) return denied;
  try { const file = (await request.formData()).get("file"); if (!(file instanceof File)) return apiFailure("Choose an image or PDF.", 400); const extension = types.get(file.type); if (!extension) return apiFailure("Only JPG, PNG, WebP and PDF files are supported.", 400); if (!file.size || file.size > 10 * 1024 * 1024) return apiFailure("Media must be 10 MB or smaller.", 400); const { env } = await getCloudflareContext({ async: true }); if (!env.EVENT_MEDIA) return apiFailure("Event media storage is unavailable.", 503); const assetId = `${crypto.randomUUID()}.${extension}`; await env.EVENT_MEDIA.put(`whatsapp-campaign-media/${assetId}`, await file.arrayBuffer(), { httpMetadata: { contentType: file.type, cacheControl: "public, max-age=31536000, immutable" }, customMetadata: { originalName: file.name.slice(0, 180) } }); return apiSuccess({ url: `${new URL(request.url).origin}/api/admin/communications/whatsapp/media/${assetId}`, filename: file.name }, { status: 201 }); }
  catch (error) { return apiFailure(error instanceof Error ? error.message : "Unable to upload WhatsApp media.", 500); }
}
