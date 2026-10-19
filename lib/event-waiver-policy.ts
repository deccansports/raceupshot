import { z } from "./zod";

export const waiverCoverageModes = ["PER_REGISTRATION", "PER_EVENT_EDITION", "MULTIPLE_SELECTED_REGISTRATIONS"] as const;

export const eventWaiverPolicySchema = z.object({
  consolidatedWaiverEnabled: z.boolean(),
  allowMultipleRegistrationsPerParticipant: z.boolean(),
  allowDuplicateEmailAddresses: z.literal(true),
  waiverCoverage: z.enum(waiverCoverageModes),
  requireSeparateWaiverForDifferentEvents: z.boolean(),
  requireSeparateWaiverForDifferentDisciplines: z.boolean(),
  allowCheckInBeforeScheduledSession: z.boolean(),
  allowCheckInAll: z.boolean(),
  requireGuardianSignatureForMinors: z.boolean(),
});

export type EventWaiverPolicy = z.infer<typeof eventWaiverPolicySchema>;

export const defaultEventWaiverPolicy: EventWaiverPolicy = {
  consolidatedWaiverEnabled: false,
  allowMultipleRegistrationsPerParticipant: true,
  allowDuplicateEmailAddresses: true,
  waiverCoverage: "PER_REGISTRATION",
  requireSeparateWaiverForDifferentEvents: true,
  requireSeparateWaiverForDifferentDisciplines: false,
  allowCheckInBeforeScheduledSession: false,
  allowCheckInAll: false,
  requireGuardianSignatureForMinors: true,
};

export function eventWaiverPolicy(value: unknown): EventWaiverPolicy {
  const parsed = eventWaiverPolicySchema.safeParse(value);
  return parsed.success ? parsed.data : defaultEventWaiverPolicy;
}

export function eventHasWaiverIntent(event: { waiverHtml?: string | null; waiverVersion?: string | null } | null | undefined): boolean {
  return Boolean(event?.waiverHtml?.trim() || event?.waiverVersion?.trim());
}
