import { z } from './zod';

export const eventTicketLegTypes = ['SWIM', 'BIKE', 'RUN', 'TRANSITION', 'OTHER'] as const;
export const eventTicketDisciplines = ['SWIM', 'BIKE', 'RUN'] as const;
export type EventTicketDiscipline = typeof eventTicketDisciplines[number];

export const eventTicketLegSchema = z.object({
  id: z.string().trim().min(1).max(120),
  name: z.string().trim().min(1).max(120),
  type: z.enum(eventTicketLegTypes),
  order: z.number().int().min(0).max(100),
  distanceKm: z.number().min(0).max(10_000).nullable(),
  cutoffSeconds: z.number().int().min(0).max(60 * 60 * 72).nullable(),
});

export const eventTicketSplitSchema = z.object({
  id: z.string().trim().min(1).max(120),
  name: z.string().trim().min(1).max(120),
  legId: z.string().trim().min(1).max(120),
  order: z.number().int().min(0).max(500),
  /** Cumulative event distance at this split. */
  distanceKm: z.number().min(0).max(10_000).nullable(),
  /** Cumulative elapsed cutoff from the official start. */
  cutoffSeconds: z.number().int().min(0).max(60 * 60 * 72).nullable(),
});

export const eventTicketDefinitionSchema = z.object({
  id: z.string().trim().min(1).max(120),
  name: z.string().trim().min(1).max(120),
  configurationSource: z.enum(['MANUAL', 'FEIBOT']),
  providerContestUuid: z.string().trim().max(160),
  participationMode: z.enum(['INDIVIDUAL', 'RELAY']),
  relayTeamSize: z.union([z.literal(2), z.literal(3)]).nullable(),
  sessionId: z.string().trim().max(120),
  sessionName: z.string().trim().max(120),
  scheduledStartAt: z.string().trim().max(80),
  totalDistanceKm: z.number().min(0).max(10_000).nullable(),
  overallCutoffSeconds: z.number().int().min(0).max(60 * 60 * 72).nullable(),
  enabledDisciplines: z.array(z.enum(eventTicketDisciplines)).max(3).optional(),
  legs: z.array(eventTicketLegSchema).max(30),
  splits: z.array(eventTicketSplitSchema).max(150),
}).superRefine((ticket, ctx) => {
  if (ticket.participationMode === 'RELAY' && ticket.relayTeamSize == null) {
    ctx.addIssue({ code: 'custom', path: ['relayTeamSize'], message: `Choose 2 or 3 athletes for relay ticket ${ticket.name}.` });
  }
  const legIds = new Set(ticket.legs.map((leg) => leg.id));
  if (legIds.size !== ticket.legs.length) ctx.addIssue({ code: 'custom', message: `Ticket ${ticket.name} has duplicate leg IDs.` });
  if (new Set(ticket.splits.map((split) => split.id)).size !== ticket.splits.length) ctx.addIssue({ code: 'custom', message: `Ticket ${ticket.name} has duplicate split IDs.` });
  ticket.splits.forEach((split, index) => {
    if (!legIds.has(split.legId)) ctx.addIssue({ code: 'custom', path: ['splits', index, 'legId'], message: `Choose a valid leg for split ${split.name}.` });
  });
});

export type EventTicketDefinition = z.infer<typeof eventTicketDefinitionSchema>;

export function legacyTicketDefinition(name: string, index = 0): EventTicketDefinition {
  const id = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `ticket-${index + 1}`;
  return {
    id,
    name: name.trim(),
    configurationSource: 'MANUAL',
    providerContestUuid: '',
    participationMode: 'INDIVIDUAL',
    relayTeamSize: null,
    sessionId: '',
    sessionName: '',
    scheduledStartAt: '',
    totalDistanceKm: null,
    overallCutoffSeconds: null,
    enabledDisciplines: [],
    legs: [],
    splits: [],
  };
}

export function resolvedTicketDisciplines(ticket: Pick<EventTicketDefinition, 'enabledDisciplines' | 'legs'>): EventTicketDiscipline[] {
  const source = ticket.enabledDisciplines ?? ticket.legs.map((leg) => leg.type);
  return eventTicketDisciplines.filter((discipline) => source.includes(discipline));
}

export function eventTicketDefinitions(value: unknown, categories: string[] = []): EventTicketDefinition[] {
  if (Array.isArray(value)) {
    const parsed = value.flatMap((item) => {
      const result = eventTicketDefinitionSchema.safeParse({ participationMode: 'INDIVIDUAL', relayTeamSize: null, sessionId: '', sessionName: '', scheduledStartAt: '', ...(item && typeof item === 'object' ? item : {}) });
      return result.success ? [result.data] : [];
    });
    if (parsed.length) return parsed;
  }
  return categories.map(legacyTicketDefinition);
}
