import type {
  AthletePrivacyPreference,
  AthleteVisibility,
  LiveParticipant,
  LiveTrackingSettings,
} from "../../contracts/src";

export function resolveAthleteVisibility({
  eventSettings,
  athletePreference,
  adminOverride,
}: {
  eventSettings: LiveTrackingSettings;
  athletePreference?: AthleteVisibility | null;
  adminOverride?: AthleteVisibility | null;
}): AthleteVisibility {
  if (!eventSettings.liveTrackingEnabled || !eventSettings.publicLiveTrackingEnabled) return "PRIVATE";
  if (eventSettings.forceVisibility) return eventSettings.forceVisibility;
  if (adminOverride) return adminOverride;
  const preferred = athletePreference ?? eventSettings.defaultAthleteVisibility;
  if (preferred === "ANONYMOUS" && !eventSettings.anonymousTrackingAllowed) {
    return eventSettings.defaultAthleteVisibility === "ANONYMOUS" ? "PUBLIC" : eventSettings.defaultAthleteVisibility;
  }
  if (preferred === "PRIVATE" && !eventSettings.privateTrackingAllowed) {
    return eventSettings.defaultAthleteVisibility === "PRIVATE" ? "PUBLIC" : eventSettings.defaultAthleteVisibility;
  }
  return preferred;
}

export function applyPublicAthletePrivacy(
  participant: LiveParticipant,
  eventSettings: LiveTrackingSettings,
  preference?: Partial<AthletePrivacyPreference>,
  adminOverride?: AthleteVisibility | null,
): LiveParticipant | null {
  const visibility = resolveAthleteVisibility({
    eventSettings,
    athletePreference: preference?.liveTrackingVisibility ?? participant.visibility,
    adminOverride,
  });
  if (visibility === "PRIVATE") return null;
  if (visibility === "ANONYMOUS") {
    return {
      ...participant,
      visibility,
      athleteUid: undefined,
      bib: "",
      displayName: "Anonymous Athlete",
      fullName: undefined,
      initials: "AN",
      photoUrl: undefined,
      country: undefined,
      club: undefined,
      team: undefined,
      ageGroup: preference?.showAgeGroup === false ? undefined : participant.ageGroup,
    };
  }
  return {
    ...participant,
    visibility,
    photoUrl: preference?.showProfilePhoto === false ? undefined : participant.photoUrl,
    country: preference?.showCountry === false ? undefined : participant.country,
    club: preference?.showClub === false ? undefined : participant.club,
    ageGroup: preference?.showAgeGroup === false ? undefined : participant.ageGroup,
    certificateUrl: preference?.showResultAfterFinish === false ? undefined : participant.certificateUrl,
  };
}
