import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { KVNamespace } from "@cloudflare/workers-types";
import type { AthletePrivacyPreference, AthleteVisibility } from "@/packages/contracts/src";
import { normalizeCountryCode } from "./countries";
import { z } from "./zod";

const PROFILE_PREFIX = "raceupshot:athlete-profile:";
const PROFILE_EMAIL_PREFIX = "raceupshot:athlete-profile-email:";
const profileImage = z.string().trim().max(180_000).refine(
  (value) => !value || value.startsWith("https://") || /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(value),
  "Choose a valid cropped profile image.",
);

export const athleteProfileInput = z.object({
  name: z.string().trim().min(2).max(100),
  phoneCountryCode: z.string().trim().regex(/^\+\d{1,4}$/, "Enter a country code such as +91."),
  mobileNumber: z.string().trim().regex(/^\d{5,15}$/, "Enter a valid mobile number using digits only."),
  country: z.string().trim().min(2).max(80),
  state: z.string().trim().min(2).max(80),
  city: z.string().trim().min(2).max(80),
  photoUrl: profileImage.optional(),
  trackingVisibility: z.enum(["PUBLIC", "ANONYMOUS"]).optional(),
});

export type AthleteProfileInput = z.infer<typeof athleteProfileInput>;

export interface AthleteProfile extends AthleteProfileInput {
  uid: string;
  email: string | null;
  updatedAt: string;
}

export function athletePrivacyPreference(profile: AthleteProfile | null): AthletePrivacyPreference | undefined {
  if (!profile) return undefined;
  return {
    liveTrackingVisibility: (profile.trackingVisibility || "PUBLIC") as AthleteVisibility,
    showProfilePhoto: profile.trackingVisibility !== "ANONYMOUS",
    showCountry: profile.trackingVisibility !== "ANONYMOUS",
    showClub: profile.trackingVisibility !== "ANONYMOUS",
    showAgeGroup: true,
    showResultAfterFinish: true,
    allowResultSharing: true,
    allowWatchlist: true,
  };
}

async function getKv(): Promise<KVNamespace> {
  const { env } = await getCloudflareContext({ async: true });
  if (!env.RACEUPSHOT) throw new Error("RACEUPSHOT KV binding is unavailable.");
  return env.RACEUPSHOT;
}

export async function getAthleteProfile(uid: string): Promise<AthleteProfile | null> {
  const profile = await (await getKv()).get<AthleteProfile & { trackingVisibility?: string }>(`${PROFILE_PREFIX}${uid}`, "json");
  if (!profile) return null;
  return {
    ...profile,
    trackingVisibility: profile.trackingVisibility === "PUBLIC" ? "PUBLIC" : "ANONYMOUS",
  };
}

export async function getAthleteProfileByEmail(emailInput: string): Promise<AthleteProfile | null> {
  const kv = await getKv();
  const email = emailInput.trim().toLowerCase();
  const indexedUid = await kv.get(`${PROFILE_EMAIL_PREFIX}${email}`);
  if (indexedUid) {
    const indexed = await getAthleteProfile(indexedUid);
    if (indexed) return indexed;
  }
  let cursor: string | undefined;
  do {
    const page = await kv.list({ prefix: PROFILE_PREFIX, cursor, limit: 1000 });
    const rows = await Promise.all(page.keys.map((key) => kv.get<AthleteProfile & { trackingVisibility?: string }>(key.name, "json")));
    const match = rows.find((profile) => profile?.email?.trim().toLowerCase() === email);
    if (match) {
      await kv.put(`${PROFILE_EMAIL_PREFIX}${email}`, match.uid);
      return {
        ...match,
        trackingVisibility: match.trackingVisibility === "PUBLIC" ? "PUBLIC" : "ANONYMOUS",
      };
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return null;
}

export async function saveAthleteProfile(
  uid: string,
  email: string | null,
  input: AthleteProfileInput,
): Promise<AthleteProfile> {
  const profile: AthleteProfile = {
    ...input,
    country: normalizeCountryCode(input.country) || input.country.trim(),
    photoUrl: input.photoUrl || "",
    trackingVisibility: input.trackingVisibility || "PUBLIC",
    uid,
    email,
    updatedAt: new Date().toISOString(),
  };
  const kv = await getKv();
  const storedUserIndex = await kv.get<unknown[]>("raceupshot:users:index", "json");
  const userIndex = Array.isArray(storedUserIndex) ? storedUserIndex : [];
  const isIndexed = userIndex.some((item) => {
    if (typeof item === "string") return item === uid;
    if (!item || typeof item !== "object") return false;
    const row = item as { uid?: unknown; userId?: unknown; id?: unknown };
    return [row.uid, row.userId, row.id].some((value) => value === uid);
  });
  await Promise.all([
    kv.put(`${PROFILE_PREFIX}${uid}`, JSON.stringify(profile)),
    ...(email ? [kv.put(`${PROFILE_EMAIL_PREFIX}${email.trim().toLowerCase()}`, uid)] : []),
    ...(!isIndexed ? [kv.put("raceupshot:users:index", JSON.stringify([...userIndex, uid]))] : []),
  ]);
  return profile;
}

export async function saveAthleteTrackingVisibility(
  uid: string,
  email: string | null,
  trackingVisibility: "PUBLIC" | "ANONYMOUS",
): Promise<AthleteProfile> {
  const current = await getAthleteProfile(uid);
  if (!current) {
    throw new Error("Complete the athlete profile before changing live tracking visibility.");
  }
  return saveAthleteProfile(uid, email, {
    name: current.name,
    phoneCountryCode: current.phoneCountryCode,
    mobileNumber: current.mobileNumber,
    country: current.country,
    state: current.state,
    city: current.city,
    photoUrl: current.photoUrl,
    trackingVisibility,
  });
}
