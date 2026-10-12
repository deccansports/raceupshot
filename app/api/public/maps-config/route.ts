import { getCloudflareContext } from "@opennextjs/cloudflare";
import { apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

const publicCorsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "accept, content-type",
  "access-control-max-age": "86400",
};

export function OPTIONS() {
  return new Response(null, { status: 204, headers: publicCorsHeaders });
}

export async function GET() {
  const { env } = await getCloudflareContext({ async: true });
  const runtime = env as unknown as Record<string, string | undefined>;
  const apiKey = runtime.GOOGLE_MAPS_BROWSER_API_KEY
    || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
    || process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY
    || "";
  return apiSuccess(
    { configured: Boolean(apiKey), apiKey },
    {
      headers: {
        "cache-control": "public, max-age=300, stale-while-revalidate=3600",
        ...publicCorsHeaders,
      },
    },
  );
}
