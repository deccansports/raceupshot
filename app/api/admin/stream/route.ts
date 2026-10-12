import { requireAdmin } from "@/lib/admin-guard";
import { apiFailure, apiSuccess } from "@/lib/api-response";
import {
  createCloudflareLiveInput,
  deleteCloudflareLiveInput,
  deleteCloudflareVideos,
  getCloudflareLiveInput,
  getCloudflareStreamDashboard,
  getCloudflareStreamDiagnostics,
  getCloudflareStreamProvisioning,
  saveCloudflareStreamLayout,
  updateCloudflareLiveInput,
} from "@/lib/cloudflare-stream";
import { z } from "@/lib/zod";

export const dynamic = "force-dynamic";

const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create-input"),
    eventId: z.string().trim().min(1).max(150),
    eventName: z.string().trim().min(1).max(180),
    name: z.string().trim().min(1).max(150),
    cameraType: z.string().trim().min(1).max(50).optional(),
    locationMode: z.enum(["fixed", "mobile"]).optional(),
    assignedLocation: z.string().trim().max(180).optional(),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
    coverageRadius: z.number().min(0).max(100000).optional(),
    priority: z.number().int().min(0).max(1000).optional(),
    recordingEnabled: z.boolean().optional(),
  }),
  z.object({
    action: z.literal("delete-input"),
    inputId: z.string().trim().min(1).max(100),
  }),
  z.object({
    action: z.literal("delete-videos"),
    videoIds: z.array(z.string().trim().min(1).max(100)).min(1).max(100),
  }),
  z.object({
    action: z.literal("reveal-key"),
    inputId: z.string().trim().min(1).max(100),
  }),
  z.object({
    action: z.literal("test-input"),
    inputId: z.string().trim().min(1).max(100),
  }),
  z.object({
    action: z.literal("camera-details"),
    inputId: z.string().trim().min(1).max(100),
  }),
  z.object({
    action: z.literal("validate-playback"),
    inputId: z.string().trim().min(1).max(100),
  }),
  z.object({
    action: z.literal("refresh-provisioning"),
    inputId: z.string().trim().min(1).max(100),
  }),
  z.object({
    action: z.literal("update-input"),
    inputId: z.string().trim().min(1).max(100),
    enabled: z.boolean().optional(),
    recordingEnabled: z.boolean().optional(),
  }),
  z.object({
    action: z.literal("rotate-key"),
    inputId: z.string().trim().min(1).max(100),
    eventId: z.string().trim().min(1).max(150),
    eventName: z.string().trim().min(1).max(180),
    name: z.string().trim().min(1).max(150),
    cameraType: z.string().trim().min(1).max(50).optional(),
    locationMode: z.enum(["fixed", "mobile"]).optional(),
    assignedLocation: z.string().trim().max(180).optional(),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
    coverageRadius: z.number().min(0).max(100000).optional(),
    priority: z.number().int().min(0).max(1000).optional(),
    recordingEnabled: z.boolean().optional(),
  }),
  z.object({
    action: z.literal("save-layout"),
    eventId: z.string().trim().min(1).max(150),
    layout: z.enum(["single", "2", "4", "9", "auto"]),
  }),
]);

export async function GET(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    const eventId = new URL(request.url).searchParams.get("eventId")?.trim() || "";
    return apiSuccess(await getCloudflareStreamDashboard(eventId), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return apiFailure(error instanceof Error ? error.message : "Unable to load Cloudflare Stream.", 502);
  }
}

export async function POST(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    const parsed = actionSchema.safeParse(await request.json());
    if (!parsed.success) return apiFailure(parsed.error.issues[0]?.message || "Invalid Stream action.", 400);
    if (parsed.data.action === "create-input") {
      return apiSuccess(await createCloudflareLiveInput(parsed.data), { status: 201, headers: { "cache-control": "no-store" } });
    }
    if (parsed.data.action === "delete-input") {
      await deleteCloudflareLiveInput(parsed.data.inputId);
      return apiSuccess({ deleted: true }, { headers: { "cache-control": "no-store" } });
    }
    if (parsed.data.action === "delete-videos") {
      const deleted = await deleteCloudflareVideos(parsed.data.videoIds);
      return apiSuccess({ deleted }, { headers: { "cache-control": "no-store" } });
    }
    if (parsed.data.action === "reveal-key") {
      const input = await getCloudflareLiveInput(parsed.data.inputId, true);
      return apiSuccess({
        inputId: input.uid,
        rtmpsUrl: input.rtmpsUrl,
        streamKey: input.streamKey,
        expiresInSeconds: 30,
      }, { headers: { "cache-control": "no-store, private" } });
    }
    if (parsed.data.action === "test-input") {
      const diagnostics = await getCloudflareStreamDiagnostics(parsed.data.inputId);
      const input = diagnostics.input;
      return apiSuccess({
        input,
        diagnostics,
        connectionState: input.status === "connected" ? "Live" : input.enabled ? "Waiting for Stream" : "Disabled",
        message: input.status === "connected"
          ? "Camera stream is live on Cloudflare."
          : input.enabled ? "Cloudflare is ready and waiting for the encoder." : "This input is disabled.",
      }, { headers: { "cache-control": "no-store" } });
    }
    if (parsed.data.action === "camera-details" || parsed.data.action === "validate-playback") {
      return apiSuccess(await getCloudflareStreamDiagnostics(parsed.data.inputId), {
        headers: { "cache-control": "no-store, private" },
      });
    }
    if (parsed.data.action === "refresh-provisioning") {
      return apiSuccess(await getCloudflareStreamProvisioning(parsed.data.inputId), {
        headers: { "cache-control": "no-store, private" },
      });
    }
    if (parsed.data.action === "update-input") {
      return apiSuccess(await updateCloudflareLiveInput(parsed.data.inputId, parsed.data), { headers: { "cache-control": "no-store" } });
    }
    if (parsed.data.action === "rotate-key") {
      const replacement = await createCloudflareLiveInput(parsed.data);
      try {
        await deleteCloudflareLiveInput(parsed.data.inputId);
      } catch (error) {
        await deleteCloudflareLiveInput(replacement.uid).catch(() => undefined);
        throw error;
      }
      return apiSuccess(replacement, { headers: { "cache-control": "no-store, private" } });
    }
    await saveCloudflareStreamLayout(parsed.data.eventId, parsed.data.layout);
    return apiSuccess({ saved: true, layout: parsed.data.layout }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return apiFailure(error instanceof Error ? error.message : "Cloudflare Stream action failed.", 502);
  }
}
