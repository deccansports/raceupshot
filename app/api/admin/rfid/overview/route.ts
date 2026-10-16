import { apiFailure, apiSuccess } from "@/lib/api-response";
import { requireAdmin } from "@/lib/admin-guard";
import { getRfidOverview } from "@/lib/rfid-encoder-repository";

export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    const overview = await getRfidOverview();
    return apiSuccess({
      ...overview,
      adapter: {
        model: "INVETON RU5600", status: "LOCAL_BRIDGE_REQUIRED", connected: false, simulation: false,
        sdkAuditStatus: "SDK_V3_2_AUDITED",
        message: "SDK V3.2 is audited. Start the authenticated local SWHidApi bridge on the encoding computer, then pair it here. Hardware success remains subject to physical reader validation.",
      },
      permissions: ["RFID_VIEW", "RFID_READ", "RFID_WRITE", "RFID_BULK_ENCODE", "RFID_INVENTORY_MANAGE", "RFID_EXPORT"],
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return apiFailure(error instanceof Error ? error.message : "RFID data could not be loaded.");
  }
}
