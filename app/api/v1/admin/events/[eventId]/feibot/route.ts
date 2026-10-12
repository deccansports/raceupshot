import { isAdminAuthenticated } from "@/lib/admin-auth";
import {
  connectFeibotEvent,
  disconnectFeibotEvent,
  getFeibotAdminConnection,
  verifyFeibotEventConnection,
} from "@/lib/feibot-integration";
import { platformFailure, platformSuccess } from "@/lib/platform-api-response";
import { z } from "@/lib/zod";

export const dynamic = "force-dynamic";

const connectionSchema = z.object({
  accessKey: z.string().max(500).optional(),
  secretKey: z.string().max(500).optional(),
  baseUrl: z.string().url().max(500).optional(),
  eventUuid: z.string().max(100).optional(),
  credentialSource: z.enum(["EVENT", "ACCOUNT"]).optional(),
  connectionId: z.string().max(300).optional(),
  label: z.string().max(160).optional(),
});

const selectionSchema = z.object({ connectionId: z.string().max(300).optional() });

export async function GET(request: Request, { params }: { params: Promise<{ eventId: string }> }) {
  if (!await isAdminAuthenticated()) return platformFailure("ADMIN_AUTH_REQUIRED", "Admin authentication required.", 401);
  try {
    const { eventId } = await params;
    const connectionId = new URL(request.url).searchParams.get("connectionId");
    return platformSuccess(await getFeibotAdminConnection(eventId, connectionId), { eventId, cacheSeconds: 0 }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return platformFailure("FEIBOT_STATUS_UNAVAILABLE", error instanceof Error ? error.message : "Unable to load Feibot status.", 503);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ eventId: string }> }) {
  if (!await isAdminAuthenticated()) return platformFailure("ADMIN_AUTH_REQUIRED", "Admin authentication required.", 401);
  try {
    const { eventId } = await params;
    const parsed = connectionSchema.safeParse(await request.json());
    if (!parsed.success) return platformFailure("INVALID_FEIBOT_REQUEST", parsed.error.issues[0]?.message ?? "Invalid Feibot request.", 400);
    return platformSuccess(
      await connectFeibotEvent(eventId, parsed.data),
      { eventId, cacheSeconds: 0 },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    const status = Number((error as { status?: number }).status);
    return platformFailure(
      status === 401 || status === 403 ? "FEIBOT_AUTH_FAILED" : "FEIBOT_REQUEST_FAILED",
      error instanceof Error ? error.message : "Feibot request failed.",
      status === 401 || status === 403 ? 401 : 502,
    );
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ eventId: string }> }) {
  if (!await isAdminAuthenticated()) return platformFailure("ADMIN_AUTH_REQUIRED", "Admin authentication required.", 401);
  try {
    const { eventId } = await params;
    return platformSuccess(
      await disconnectFeibotEvent(eventId, new URL(request.url).searchParams.get("connectionId")),
      { eventId, cacheSeconds: 0 },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return platformFailure("FEIBOT_DISCONNECT_FAILED", error instanceof Error ? error.message : "Unable to remove Feibot connection.", 500);
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ eventId: string }> }) {
  if (!await isAdminAuthenticated()) return platformFailure("ADMIN_AUTH_REQUIRED", "Admin authentication required.", 401);
  try {
    const { eventId } = await params;
    const parsed = selectionSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return platformFailure("INVALID_FEIBOT_REQUEST", parsed.error.issues[0]?.message ?? "Invalid Feibot request.", 400);
    const connection = await verifyFeibotEventConnection(eventId, parsed.data.connectionId);
    if (!connection.connected) return platformFailure("FEIBOT_VERIFY_FAILED", connection.endpoints.timingRules.message || "Feibot verification failed.", 502);
    return platformSuccess(connection, { eventId, cacheSeconds: 0 }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return platformFailure("FEIBOT_VERIFY_FAILED", error instanceof Error ? error.message : "Unable to verify Feibot connection.", 502);
  }
}
