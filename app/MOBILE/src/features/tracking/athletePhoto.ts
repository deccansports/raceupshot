function text(value: unknown): string {
  return String(value ?? '').trim();
}

function normalizeEmail(value: unknown): string {
  return text(value).toLowerCase();
}

function firstPhoto(...values: unknown[]): string | undefined {
  for (const value of values) {
    const candidate = text(value);
    if (candidate) return candidate;
  }
  return undefined;
}

export type AthletePhotoIdentity = {
  email?: string | null;
  athleteUid?: string | null;
  uid?: string | null;
  userId?: string | null;
  participantUserId?: string | null;
  participantLinkedUserId?: string | null;
  photoUrl?: string | null;
  profilePhotoUrl?: string | null;
  photoURL?: string | null;
  avatarUrl?: string | null;
  displayPhoto?: string | null;
};

export type AthletePhotoProfile = {
  email?: string | null;
  uid?: string | null;
  profilePhotoUrl?: string | null;
  profileUrl?: string | null;
  profileURL?: string | null;
} | null;

/**
 * Resolve the best visible athlete photo.
 *
 * Matching priority:
 * 1. Match by normalized email.
 * 2. Match by uid/athlete uid when email is not available.
 * 3. Match by participant-linked user id.
 * 4. Use any photo already supplied on the athlete payload.
 */
export function resolveAthletePhoto(
  identity: AthletePhotoIdentity,
  profile?: AthletePhotoProfile,
): string | undefined {
  const direct = firstPhoto(
    identity.photoUrl,
    identity.profilePhotoUrl,
    identity.photoURL,
    identity.avatarUrl,
    identity.displayPhoto,
  );
  const profilePhoto = firstPhoto(
    profile?.profilePhotoUrl,
    profile?.profileUrl,
    profile?.profileURL,
  );
  if (!profilePhoto) return direct;
  if (identity.email && profile?.email && normalizeEmail(identity.email) === normalizeEmail(profile.email)) {
    return profilePhoto;
  }
  const identityUid = text(identity.uid || identity.athleteUid || identity.userId);
  const participantUserId = text(identity.participantUserId || identity.participantLinkedUserId);
  const profileUid = text(profile?.uid);
  if (identityUid && profileUid && identityUid === profileUid) {
    return profilePhoto;
  }
  if (participantUserId && profileUid && participantUserId === profileUid) {
    return profilePhoto;
  }
  return direct;
}
