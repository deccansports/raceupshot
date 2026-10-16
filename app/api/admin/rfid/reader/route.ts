import { apiFailure } from "@/lib/api-response";
import { requireAdmin } from "@/lib/admin-guard";

export async function POST() {
  const denied = await requireAdmin();
  if (denied) return denied;
  return apiFailure("RU5600 hardware operations run through the authenticated loopback SWHidApi bridge on the encoding computer. Connect from the RFID admin screen; the Cloudflare Worker cannot access local USB hardware.", 409);
}
