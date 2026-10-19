import { getAuthenticatedAdminEmail } from "@/lib/admin-auth";
import { apiFailure, apiSuccess } from "@/lib/api-response";
import { listRfidProfiles, saveRfidProfile } from "@/lib/rfid-encoder-repository";
import { z } from "@/lib/zod";

export const dynamic = "force-dynamic";

const profileSchema = z.object({
  id: z.string().trim().max(100).default(""),
  name: z.string().trim().min(3).max(100),
  epcLength: z.number().int().min(2).max(128),
  prefix: z.string().trim().max(128),
  chipNumberPosition: z.number().int().min(0).max(127),
  chipNumberLength: z.number().int().min(1).max(128),
  numberEncoding: z.enum(["DECIMAL_DIGITS", "BCD", "ASCII", "HEX_INTEGER"]),
  leadingZeroPolicy: z.enum(["PAD", "PRESERVE", "REJECT"]),
  sequenceIncrement: z.number().int().min(1).max(1_000_000),
  maximumChipNumber: z.string().trim().regex(/^\d+$/),
  verified: z.boolean(),
  active: z.boolean(),
  notes: z.string().trim().max(2000).optional(),
});

export async function GET() {
  const admin = await getAuthenticatedAdminEmail();
  if (!admin) return apiFailure("Admin authentication required.", 401);
  return apiSuccess(await listRfidProfiles());
}

export async function POST(request: Request) {
  const admin = await getAuthenticatedAdminEmail();
  if (!admin) return apiFailure("Admin authentication required.", 401);
  try {
    const input = profileSchema.safeParse(await request.json());
    if (!input.success) return apiFailure(input.error.issues[0]?.message || "Check the EPC profile.", 400);
    return apiSuccess(await saveRfidProfile(input.data, admin), { status: 201 });
  } catch (error) {
    return apiFailure(error instanceof Error ? error.message : "EPC profile could not be saved.", 400);
  }
}
