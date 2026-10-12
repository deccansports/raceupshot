import { apiSuccess } from "@/lib/api-response";
import { clearOtpAthleteSession, readOtpAthleteSession } from "@/lib/athlete-session";

export async function GET() {
  const athlete = await readOtpAthleteSession();
  return apiSuccess({ authenticated: Boolean(athlete), athlete }, {
    headers: { "cache-control": "private, no-store" },
  });
}

export async function DELETE() {
  await clearOtpAthleteSession();
  return apiSuccess({ authenticated: false }, {
    headers: { "cache-control": "private, no-store" },
  });
}
