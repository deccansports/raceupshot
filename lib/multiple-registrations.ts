import type { EventWaiverPolicy } from "./event-waiver-policy";

export interface RegistrationIdentity {
  registrationId: string;
  participantId: string;
  eventEditionId: string;
  raceCategoryId: string;
}

export interface WaiverCoverage {
  waiverId: string;
  participantId: string;
  eventEditionId: string;
  waiverVersion: string;
  registrationIds: string[];
}

export function groupRegistrationsByParticipant<T extends RegistrationIdentity>(registrations: T[]): Array<{ participantId: string; registrations: T[] }> {
  const groups = new Map<string, T[]>();
  for (const registration of registrations) groups.set(registration.participantId, [...(groups.get(registration.participantId) ?? []), registration]);
  return [...groups].map(([participantId, rows]) => ({ participantId, registrations: rows }));
}

export function validateConsolidatedWaiverSelection(registrations: RegistrationIdentity[], policy: EventWaiverPolicy): void {
  if (!registrations.length) throw new Error("Choose at least one registration.");
  if (new Set(registrations.map((row) => row.registrationId)).size !== registrations.length) throw new Error("A registration cannot be selected twice.");
  if (new Set(registrations.map((row) => row.participantId)).size !== 1) throw new Error("A consolidated waiver cannot combine different participant profiles.");
  if (new Set(registrations.map((row) => row.eventEditionId)).size !== 1) throw new Error("Waiver coverage is evaluated independently for each event edition.");
  if ((!policy.consolidatedWaiverEnabled || policy.waiverCoverage === "PER_REGISTRATION") && registrations.length > 1) throw new Error("This event requires a separate waiver for each registration.");
  if (policy.requireSeparateWaiverForDifferentDisciplines && new Set(registrations.map((row) => row.raceCategoryId)).size > 1) throw new Error("This event requires separate waivers for different disciplines.");
}

export function waiverCoversRegistration(waiver: WaiverCoverage, registration: RegistrationIdentity, acceptedWaiverVersion: string): boolean {
  return waiver.participantId === registration.participantId
    && waiver.eventEditionId === registration.eventEditionId
    && waiver.waiverVersion === acceptedWaiverVersion
    && waiver.registrationIds.includes(registration.registrationId);
}
